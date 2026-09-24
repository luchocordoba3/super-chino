import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PAYMENT_METHODS, type PaymentMethod, type PosEvent, round2 } from '@super-chino/shared';
import { api } from '../api';
import { beep } from '../components/BarcodeScanner';
import { Field, Modal, toast, toNum } from '../components/ui';
import { setLang } from '../i18n';
import { money, qtyFmt, setCurrency, timeFmt } from '../lib/format';
import type { Me } from '../lib/me';
import { addItem, type CartItem, cartTotal, type OfferInfo, parseScan, priceCart, settlePayments } from '../pos/cart';
import { type CashSessionLocal, type CatalogProduct, db, kvDel, kvGet, kvSet, type LocalSale, normalize, type PosUser, type StoreInfo } from '../pos/db';
import { verifyPin } from '../pos/pin';
import { enqueue, flushOutbox, getDeviceToken, linkDevice, pendingCount, refreshCatalog, syncEvents, UnlinkedError, unsyncedOfferQty } from '../pos/sync';

type Phase = 'loading' | 'unlinked' | 'pick' | 'open' | 'sell';
const uuid = () => crypto.randomUUID();
const nowIso = () => new Date().toISOString();

/** La caja: funciona con o sin internet. Todo se guarda en la PC y se sincroniza solo. */
export function Pos() {
  const { t } = useTranslation();
  const [phase, setPhase] = useState<Phase>('loading');
  const [store, setStore] = useState<StoreInfo | null>(null);
  const [cashier, setCashier] = useState<PosUser | null>(null);
  const [session, setSession] = useState<CashSessionLocal | null>(null);
  const [online, setOnline] = useState(navigator.onLine);
  const [pending, setPending] = useState(0);

  const loadLocal = useCallback(async () => {
    const s = await kvGet<StoreInfo>('store');
    if (s) {
      setStore(s);
      setCurrency(s.currency);
    }
    setSession((await kvGet<CashSessionLocal>('cashSession')) ?? null);
  }, []);

  const start = useCallback(async () => {
    if (!(await getDeviceToken())) return setPhase('unlinked');
    await loadLocal();
    setPhase('pick');
    try {
      await refreshCatalog();
      await loadLocal();
      setOnline(true);
    } catch (e) {
      if (e instanceof UnlinkedError) setPhase('unlinked');
      else setOnline(false);
    }
  }, [loadLocal]);

  useEffect(() => {
    void start();
  }, [start]);

  // Sincronización en segundo plano.
  useEffect(() => {
    const update = () => void pendingCount().then(setPending);
    const onFail = (e: unknown) => {
      if (e instanceof UnlinkedError) {
        toast(t('pos.unlinked'));
        setPhase('unlinked');
      } else setOnline(false);
    };
    const sync = () =>
      flushOutbox()
        .then(() => refreshCatalog())
        .then(() => setOnline(true))
        .catch(onFail);
    const offline = () => setOnline(false);
    syncEvents.addEventListener('change', update);
    window.addEventListener('online', sync);
    window.addEventListener('offline', offline);
    const id = setInterval(sync, 20_000);
    update();
    return () => {
      syncEvents.removeEventListener('change', update);
      window.removeEventListener('online', sync);
      window.removeEventListener('offline', offline);
      clearInterval(id);
    };
  }, [t]);

  const pickCashier = (u: PosUser) => {
    setCashier(u);
    setLang(u.lang);
    setPhase(session ? 'sell' : 'open');
  };

  if (phase === 'loading') return <div className="center-box">{t('common.loading')}</div>;
  if (phase === 'unlinked') return <LinkScreen onLinked={() => void start()} />;

  const status = (
    <span className={`pos-status ${online ? '' : 'off'}`}>
      {online ? '●' : t('common.offline')} · {pending ? t('pos.pendingSync', { count: pending }) : t('pos.synced')}
    </span>
  );

  if (phase === 'pick' || !cashier) {
    return (
      <div className="center-box stack">
        <div className="row between">
          <h1>🛒 {store?.name}</h1>
          {status}
        </div>
        <PickCashier onPicked={pickCashier} />
        <a href="/">← {t('nav.home')}</a>
      </div>
    );
  }
  if (phase === 'open' || !session) {
    return (
      <OpenCash
        cashier={cashier}
        onOpened={(s) => {
          setSession(s);
          setPhase('sell');
        }}
        onBack={() => setPhase('pick')}
      />
    );
  }
  return (
    <SellScreen
      store={store}
      cashier={cashier}
      session={session}
      status={status}
      onSwitch={() => {
        setCashier(null);
        setPhase('pick');
      }}
      onClosed={() => {
        setSession(null);
        setCashier(null);
        setPhase('pick');
      }}
    />
  );
}

function LinkScreen({ onLinked }: { onLinked: () => void }) {
  const { t } = useTranslation();
  const [owner, setOwner] = useState<boolean | null>(null);
  const [name, setName] = useState('Caja 1');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api<Me>('/auth/me')
      .then((m) => setOwner(m.user.role === 'OWNER'))
      .catch(() => setOwner(false));
  }, []);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await linkDevice(name);
      onLinked();
    } catch (err) {
      toast(String(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="center-box card stack">
      <h1>{t('pos.title')}</h1>
      <p>{t('pos.notLinked')}</p>
      {owner === false && (
        <>
          <p className="muted">{t('pos.needOwner')}</p>
          <a className="btn" href="/">
            {t('login.enter')}
          </a>
        </>
      )}
      {owner && (
        <form className="stack" onSubmit={submit}>
          <Field label={t('pos.deviceName')}>
            <input value={name} onChange={(e) => setName(e.target.value)} required />
          </Field>
          <button className="primary big" disabled={busy}>
            {t('pos.linkThisPc')}
          </button>
        </form>
      )}
    </div>
  );
}

function PickCashier({ onPicked }: { onPicked: (u: PosUser) => void }) {
  const { t } = useTranslation();
  const [users, setUsers] = useState<PosUser[]>([]);
  const [sel, setSel] = useState<PosUser | null>(null);
  const [pin, setPin] = useState('');
  const [err, setErr] = useState('');
  useEffect(() => {
    const load = () => void db.users.toArray().then((u) => setUsers(u.sort((a, b) => a.name.localeCompare(b.name))));
    load();
    syncEvents.addEventListener('change', load);
    return () => syncEvents.removeEventListener('change', load);
  }, []);
  const tryPin = async (p: string) => {
    if (sel && (await verifyPin(p, sel.pin))) onPicked(sel);
    else {
      setErr(t('pos.wrongPin'));
      setPin('');
    }
  };
  if (!sel) {
    return (
      <div className="card stack">
        <h2>{t('pos.whoSells')}</h2>
        <div className="user-tiles">
          {users.map((u) => (
            <button key={u.id} onClick={() => setSel(u)}>
              {u.name}
            </button>
          ))}
        </div>
      </div>
    );
  }
  return (
    <form
      className="card stack"
      onSubmit={(e) => {
        e.preventDefault();
        void tryPin(pin);
      }}
    >
      <h2>
        {sel.name} · {t('pos.enterPin')}
      </h2>
      <input type="password" inputMode="numeric" autoFocus value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} style={{ fontSize: '1.6rem', textAlign: 'center' }} />
      {err && <p className="error">{err}</p>}
      <div className="pinpad">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9', '←', '0', '✓'].map((k) => (
          <button
            type={k === '✓' ? 'submit' : 'button'}
            key={k}
            className={k === '✓' ? 'primary' : ''}
            onClick={() => (k === '←' ? setPin(pin.slice(0, -1)) : k !== '✓' && setPin(pin + k))}
          >
            {k}
          </button>
        ))}
      </div>
      <button type="button" className="ghost" onClick={() => (setSel(null), setPin(''), setErr(''))}>
        ← {t('common.back')}
      </button>
    </form>
  );
}

function OpenCash({ cashier, onOpened, onBack }: { cashier: PosUser; onOpened: (s: CashSessionLocal) => void; onBack: () => void }) {
  const { t } = useTranslation();
  const [amount, setAmount] = useState('');
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const s: CashSessionLocal = { id: uuid(), userId: cashier.id, openedAt: nowIso(), openingAmount: toNum(amount) ?? 0 };
    await kvSet('cashSession', s);
    await enqueue({ id: uuid(), type: 'CASH_OPEN', userId: cashier.id, occurredAt: s.openedAt, cashSessionId: s.id, openingAmount: s.openingAmount });
    onOpened(s);
  };
  return (
    <form className="center-box card stack" onSubmit={submit}>
      <h1>{t('pos.openCash')}</h1>
      <p>{cashier.name}</p>
      <Field label={t('pos.openingAmount')}>
        <input autoFocus inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} style={{ fontSize: '1.4rem' }} />
      </Field>
      <button className="primary big">{t('pos.openCash')}</button>
      <button type="button" className="ghost" onClick={onBack}>
        ← {t('common.back')}
      </button>
    </form>
  );
}

function SellScreen(props: {
  store: StoreInfo | null;
  cashier: PosUser;
  session: CashSessionLocal;
  status: React.ReactNode;
  onSwitch: () => void;
  onClosed: () => void;
}) {
  const { store, cashier, session } = props;
  const { t } = useTranslation();
  const cartKey = `pos.cart.${session.id}`;
  const [items, setItems] = useState<CartItem[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(cartKey) ?? '[]') as CartItem[];
    } catch {
      return [];
    }
  });
  useEffect(() => {
    try {
      if (items.length) localStorage.setItem(cartKey, JSON.stringify(items));
      else localStorage.removeItem(cartKey);
    } catch {
      // sin localStorage: el carrito queda solo en memoria
    }
  }, [items, cartKey]);
  const [offers, setOffers] = useState<Map<string, OfferInfo>>(new Map());
  const [input, setInput] = useState('');
  const [results, setResults] = useState<{ list: CatalogProduct[]; qty: number | null } | null>(null);
  const [weightFor, setWeightFor] = useState<CatalogProduct | null>(null);
  const [paying, setPaying] = useState(false);
  const [done, setDone] = useState<LocalSale | null>(null);
  const [closing, setClosing] = useState(false);
  const [recent, setRecent] = useState<LocalSale[]>([]);
  const [printing, setPrinting] = useState<LocalSale | null>(null);
  const [catalogCount, setCatalogCount] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const canOverride = cashier.role === 'OWNER' || cashier.perms.includes('prices');
  const focus = () => setTimeout(() => inputRef.current?.focus(), 0);

  const loadSide = useCallback(async () => {
    const [rows, used] = await Promise.all([db.offers.toArray(), unsyncedOfferQty()]);
    setOffers(new Map(rows.map((o) => [o.productId, { id: o.id, offerPrice: o.offerPrice, remaining: Math.max(0, o.maxQty - (used.get(o.id) ?? 0)) }])));
    setRecent(await db.sales.where('cashSessionId').equals(session.id).reverse().sortBy('occurredAt'));
    setCatalogCount(await db.products.count());
  }, [session.id]);

  useEffect(() => {
    void loadSide();
    syncEvents.addEventListener('change', loadSide);
    return () => syncEvents.removeEventListener('change', loadSide);
  }, [loadSide]);

  const lines = useMemo(() => priceCart(items, offers), [items, offers]);
  const total = cartTotal(lines);

  const add = (p: CatalogProduct, qty: number) => {
    setItems((prev) => addItem(prev, p, qty));
    setResults(null);
    beep();
    focus();
  };

  const onScan = async (raw: string) => {
    const { qty, code } = parseScan(raw);
    setInput('');
    if (!code) return;
    const p = await db.products.where('barcode').equals(code).first();
    if (p?.active) {
      if (p.unit === 'KG' && qty == null) return setWeightFor(p);
      return add(p, qty ?? 1);
    }
    const term = normalize(code);
    const list = await db.products.filter((x) => x.active && x.search.includes(term)).limit(12).toArray();
    if (list.length === 0) {
      toast(t('pos.notFoundCode', { code }));
      return focus();
    }
    setResults({ list, qty });
  };

  const removeLine = (productId: string, overridden: boolean) => {
    const it = items.find((x) => x.productId === productId && (x.overridePrice != null) === overridden);
    if (!it) return;
    setItems((prev) => prev.filter((x) => x !== it));
    void enqueue({ id: uuid(), type: 'ITEM_REMOVED', userId: cashier.id, occurredAt: nowIso(), cashSessionId: session.id, productId, qty: it.qty, amount: round2(it.qty * (it.overridePrice ?? it.listPrice)) });
    focus();
  };

  const changeQty = (productId: string, delta: number) =>
    setItems((prev) => prev.map((x) => (x.productId === productId && x.overridePrice == null ? { ...x, qty: Math.max(1, x.qty + delta) } : x)));

  const override = (productId: string) => {
    const v = toNum(window.prompt(t('pos.overridePrice')) ?? '');
    if (v == null || v < 0) return;
    setItems((prev) => prev.map((x) => (x.productId === productId ? { ...x, overridePrice: v } : x)));
    focus();
  };

  const clearCart = () => {
    if (items.length === 0) return;
    for (const it of items) {
      void enqueue({ id: uuid(), type: 'ITEM_REMOVED', userId: cashier.id, occurredAt: nowIso(), cashSessionId: session.id, productId: it.productId, qty: it.qty, amount: round2(it.qty * (it.overridePrice ?? it.listPrice)) });
    }
    setItems([]);
    focus();
  };

  const confirmSale = async (payments: { method: PaymentMethod; amount: number }[], change: number) => {
    const id = uuid();
    const occurredAt = nowIso();
    const event: PosEvent = {
      id,
      type: 'SALE',
      userId: cashier.id,
      occurredAt,
      cashSessionId: session.id,
      items: lines.map((l) => ({ productId: l.productId, qty: l.qty, unitPrice: l.unitPrice, listPrice: l.listPrice, offerId: l.offerId, priceOverride: l.priceOverride })),
      payments,
      total,
    };
    const local: LocalSale = {
      id,
      occurredAt,
      userId: cashier.id,
      cashSessionId: session.id,
      lines: lines.map((l) => ({ name: l.name, qty: l.qty, unitPrice: l.unitPrice, lineTotal: l.lineTotal, offer: !!l.offerId })),
      total,
      payments,
      change,
    };
    await db.sales.put(local);
    await enqueue(event);
    const old = await db.sales.orderBy('occurredAt').reverse().offset(300).primaryKeys();
    if (old.length) await db.sales.bulkDelete(old);
    setItems([]);
    setPaying(false);
    setDone(local);
    void loadSide();
  };

  const voidSale = async (s: LocalSale) => {
    const reason = window.prompt(t('pos.voidReason'));
    if (reason === null) return;
    await enqueue({ id: uuid(), type: 'SALE_VOIDED', userId: cashier.id, occurredAt: nowIso(), cashSessionId: session.id, saleId: s.id, reason });
    await db.sales.update(s.id, { voided: true });
    void loadSide();
  };

  const print = (s: LocalSale) => {
    setPrinting(s);
    setTimeout(() => window.print(), 50);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (paying || done || closing || weightFor) return;
      if (e.key === 'F2') {
        e.preventDefault();
        inputRef.current?.focus();
      } else if (e.key === 'F12' && items.length) {
        e.preventDefault();
        setPaying(true);
      } else if (e.key === 'Escape') {
        if (results) setResults(null);
        else clearCart();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  return (
    <div className="pos">
      <div className="pos-left">
        <div className="pos-top no-print">
          <strong className="grow">🛒 {store?.name}</strong>
          <span>{cashier.name}</span>
          {props.status}
          <button onClick={props.onSwitch}>{t('pos.changeCashier')}</button>
          <button onClick={() => setClosing(true)}>{t('pos.closeCash')}</button>
        </div>
        <form
          className="pos-scan no-print"
          onSubmit={(e) => {
            e.preventDefault();
            void onScan(input);
          }}
        >
          <input ref={inputRef} autoFocus value={input} onChange={(e) => setInput(e.target.value)} placeholder={t('pos.scanHere')} />
          <div className="hint">
            {t('pos.keyboardHelp')} · {t('pos.catalogInfo', { count: catalogCount })}
          </div>
        </form>
        {results && (
          <div className="pos-cart" style={{ flex: 'none', maxHeight: '40vh' }}>
            {results.list.map((p) => (
              <button key={p.id} className="pos-line" style={{ width: '100%', textAlign: 'left' }} onClick={() => (p.unit === 'KG' && results.qty == null ? setWeightFor(p) : add(p, results.qty ?? 1))}>
                <span className="n">{p.name}</span>
                <span className="muted small">{p.barcode}</span>
                <span />
                <strong>{money(p.price)}</strong>
              </button>
            ))}
          </div>
        )}
        <div className="pos-cart">
          {lines.length === 0 && <p className="muted">{t('pos.emptyCart')}</p>}
          {lines.map((l) => (
            <div className="pos-line" key={l.key}>
              <div>
                <div className="n">{l.name}</div>
                <div className="small muted">
                  {qtyFmt(l.qty)} {l.unit === 'KG' ? 'kg' : ''} × {money(l.unitPrice)}
                  {l.offerId && <span className="badge red"> {t('pos.offer')}</span>}
                  {l.priceOverride && <span className="badge gold"> {t('pos.overridePrice')}</span>}
                </div>
              </div>
              {l.unit === 'UNIT' && !l.priceOverride ? (
                <div className="row">
                  <button className="small" onClick={() => changeQty(l.productId, -1)}>
                    −
                  </button>
                  <button className="small" onClick={() => changeQty(l.productId, 1)}>
                    +
                  </button>
                </div>
              ) : (
                <span />
              )}
              <strong>{money(l.lineTotal)}</strong>
              <div className="row">
                {canOverride && !l.priceOverride && (
                  <button className="small ghost" title={t('pos.overridePrice')} onClick={() => override(l.productId)}>
                    $
                  </button>
                )}
                <button className="small ghost" onClick={() => removeLine(l.productId, l.priceOverride)}>
                  ✕
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="pos-right no-print">
        <div className="pos-total">{money(total)}</div>
        <button className="primary big" disabled={!items.length} onClick={() => setPaying(true)}>
          {t('pos.pay')} (F12)
        </button>
        <button disabled={!items.length} onClick={clearCart}>
          {t('pos.clearCart')}
        </button>
        <h3>{t('pos.lastSales')}</h3>
        {recent.slice(0, 15).map((s) => (
          <div key={s.id} className="list-item small">
            <span className="muted">{timeFmt(s.occurredAt)}</span>
            <span className="grow" style={{ textDecoration: s.voided ? 'line-through' : undefined }}>
              {money(s.total)}
            </span>
            <button className="small ghost" onClick={() => print(s)} title={t('pos.printTicket')}>
              🖨
            </button>
            {!s.voided && (
              <button className="small danger" onClick={() => void voidSale(s)}>
                {t('pos.voidSale')}
              </button>
            )}
          </div>
        ))}
      </div>

      {weightFor && (
        <WeightModal
          product={weightFor}
          onClose={() => (setWeightFor(null), focus())}
          onOk={(w) => {
            add(weightFor, w);
            setWeightFor(null);
          }}
        />
      )}
      {paying && <PayModal total={total} onClose={() => (setPaying(false), focus())} onConfirm={confirmSale} />}
      {done && (
        <Modal title={t('pos.saleDone')} onClose={() => (setDone(null), focus())}>
          <div className="stack">
            <div className="pos-total">{money(done.total)}</div>
            {done.change > 0 && (
              <div className="pos-total" style={{ color: 'var(--ok)' }}>
                {t('pos.change')}: {money(done.change)}
              </div>
            )}
            <button onClick={() => print(done)}>🖨 {t('pos.printTicket')}</button>
            <button className="primary big" autoFocus onClick={() => (setDone(null), focus())}>
              {t('pos.newSale')}
            </button>
          </div>
        </Modal>
      )}
      {closing && <CloseCash session={session} cashier={cashier} recent={recent} onClose={() => setClosing(false)} onClosed={props.onClosed} />}
      {printing && <Ticket sale={printing} store={store} />}
    </div>
  );
}

function WeightModal({ product, onOk, onClose }: { product: CatalogProduct; onOk: (w: number) => void; onClose: () => void }) {
  const { t } = useTranslation();
  const [w, setW] = useState('');
  return (
    <Modal title={`${product.name} · ${money(product.price)}/kg`} onClose={onClose}>
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          const n = toNum(w);
          if (n && n > 0) onOk(n);
        }}
      >
        <Field label={t('pos.weight')}>
          <input autoFocus inputMode="decimal" value={w} onChange={(e) => setW(e.target.value)} style={{ fontSize: '1.4rem' }} />
        </Field>
        <button className="primary big">{t('common.add')}</button>
      </form>
    </Modal>
  );
}

function PayModal({ total, onClose, onConfirm }: { total: number; onClose: () => void; onConfirm: (p: { method: PaymentMethod; amount: number }[], change: number) => void }) {
  const { t } = useTranslation();
  const [rows, setRows] = useState<{ method: PaymentMethod; amount: string }[]>([{ method: 'CASH', amount: String(total) }]);
  const parsed = rows.map((r) => ({ method: r.method, amount: toNum(r.amount) ?? 0 }));
  const { payments, change, missing } = settlePayments(total, parsed);
  const setRow = (i: number, patch: Partial<{ method: PaymentMethod; amount: string }>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const bills = [...new Set([total, Math.ceil(total / 1000) * 1000, Math.ceil(total / 2000) * 2000, Math.ceil(total / 10000) * 10000])];
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (missing <= 0) onConfirm(payments as { method: PaymentMethod; amount: number }[], change);
  };
  return (
    <Modal title={`${t('pos.pay')} ${money(total)}`} onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        {rows.map((r, i) => (
          <div key={i} className="stack">
            <div className="row">
              {PAYMENT_METHODS.map((m) => (
                <button type="button" key={m} className={`small ${r.method === m ? 'primary' : ''}`} onClick={() => setRow(i, { method: m })}>
                  {t(`pos.methods.${m}`)}
                </button>
              ))}
            </div>
            <Field label={r.method === 'CASH' ? t('pos.received') : t('common.total')}>
              <input autoFocus={i === 0} inputMode="decimal" value={r.amount} onChange={(e) => setRow(i, { amount: e.target.value })} style={{ fontSize: '1.4rem' }} />
            </Field>
            {r.method === 'CASH' && i === 0 && (
              <div className="row">
                {bills.map((b) => (
                  <button type="button" key={b} className="small" onClick={() => setRow(i, { amount: String(b) })}>
                    {money(b)}
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
        {missing > 0 && (
          <>
            <p className="warn">
              {t('pos.remaining')}: {money(missing)}
            </p>
            <button type="button" onClick={() => setRows([...rows, { method: 'DEBIT', amount: String(missing) }])}>
              + {t('pos.addPayment')}
            </button>
          </>
        )}
        {change > 0 && (
          <p className="pos-total" style={{ fontSize: '1.8rem', color: 'var(--ok)' }}>
            {t('pos.change')}: {money(change)}
          </p>
        )}
        <button className="primary big" disabled={missing > 0}>
          {t('pos.confirmSale')}
        </button>
      </form>
    </Modal>
  );
}

function CloseCash({ session, cashier, recent, onClose, onClosed }: { session: CashSessionLocal; cashier: PosUser; recent: LocalSale[]; onClose: () => void; onClosed: () => void }) {
  const { t } = useTranslation();
  const [counted, setCounted] = useState('');
  const [result, setResult] = useState<{ expected: number; counted: number } | null>(null);
  const expected = round2(
    session.openingAmount + recent.filter((s) => !s.voided).reduce((sum, s) => sum + s.payments.filter((p) => p.method === 'CASH').reduce((a, p) => a + p.amount, 0), 0),
  );
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const c = toNum(counted) ?? 0;
    await enqueue({ id: uuid(), type: 'CASH_CLOSE', userId: cashier.id, occurredAt: nowIso(), cashSessionId: session.id, countedAmount: c });
    await kvDel('cashSession');
    setResult({ expected, counted: c });
  };
  if (result) {
    const diff = round2(result.counted - result.expected);
    return (
      <Modal title={t('pos.cashClosed')} onClose={onClosed}>
        <div className="stack">
          <p>
            {t('pos.expected')}: <strong>{money(result.expected)}</strong>
          </p>
          <p>
            {t('pos.countedAmount')}: <strong>{money(result.counted)}</strong>
          </p>
          <p className={diff === 0 ? 'ok' : 'error'}>
            {t('pos.difference')}: <strong>{money(diff)}</strong>
          </p>
          <button className="primary" onClick={onClosed}>
            {t('common.close')}
          </button>
        </div>
      </Modal>
    );
  }
  return (
    <Modal title={t('pos.closeCash')} onClose={onClose}>
      <form className="stack" onSubmit={(e) => void submit(e)}>
        <Field label={t('pos.countedAmount')}>
          <input autoFocus inputMode="decimal" value={counted} onChange={(e) => setCounted(e.target.value)} style={{ fontSize: '1.4rem' }} required />
        </Field>
        <button className="primary big">{t('pos.closeCash')}</button>
      </form>
    </Modal>
  );
}

function Ticket({ sale, store }: { sale: LocalSale; store: StoreInfo | null }) {
  const { t } = useTranslation();
  return (
    <div className="print-area ticket print-only">
      <div style={{ textAlign: 'center', fontWeight: 700 }}>{store?.name}</div>
      <div>{new Date(sale.occurredAt).toLocaleString('es-AR')}</div>
      <div>#{sale.id.slice(0, 8)}</div>
      <hr />
      {sale.lines.map((l, i) => (
        <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
          <span>
            {qtyFmt(l.qty)} {l.name}
            {l.offer ? ' *' : ''}
          </span>
          <span>{money(l.lineTotal)}</span>
        </div>
      ))}
      <hr />
      <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700 }}>
        <span>{t('common.total')}</span>
        <span>{money(sale.total)}</span>
      </div>
      {sale.payments.map((p, i) => (
        <div key={i} style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span>{t(`pos.methods.${p.method}`)}</span>
          <span>{money(p.amount)}</span>
        </div>
      ))}
      {sale.change > 0 && (
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span>{t('pos.change')}</span>
          <span>{money(sale.change)}</span>
        </div>
      )}
      <hr />
      <div style={{ textAlign: 'center' }}>{t('pos.ticketFooter')}</div>
    </div>
  );
}
