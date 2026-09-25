import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CASH_MOVE_KINDS, type CashMoveKind, cashMoveSign, PAYMENT_METHODS, type PaymentMethod, type PosEvent, round2 } from '@almacen/shared';
import { api } from '../api';
import { beep, ScanButton } from '../components/BarcodeScanner';
import { Field, Modal, toast, toNum } from '../components/ui';
import { setLang } from '../i18n';
import { money, qtyFmt, setCurrency, timeFmt } from '../lib/format';
import type { Me } from '../lib/me';
import { addItem, type CartItem, cartTotal, type OfferInfo, parseScan, priceCart, settlePayments } from '../pos/cart';
import { type CashMoveLocal, type CashSessionLocal, type CatalogProduct, type CategoryRow, db, type Handover, type LocalTab, kvDel, kvGet, kvSet, type LocalSale, normalize, type PosUser, type StoreInfo, type SupplierRow } from '../pos/db';
import { verifyPin } from '../pos/pin';
import { enqueue, flushOutbox, getDeviceToken, linkDevice, pendingCount, posGet, posPost, refreshCatalog, refreshTabs, syncEvents, UnlinkedError, unsyncedOfferQty } from '../pos/sync';
import { cancelTab, openTab, setTabQty } from '../pos/tabs';

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
  const [clocking, setClocking] = useState(false);

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
          <h1>🏪 {store?.name}</h1>
          {status}
        </div>
        <PickUser title={t('pos.whoSells')} only={(u) => u.role === 'OWNER' || u.canSell !== false} onPicked={pickCashier} />
        <button className="big" onClick={() => setClocking(true)}>
          🕘 {t('pos.clockInOut')}
        </button>
        {clocking && <ClockModal onClose={() => setClocking(false)} />}
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

/** Elegir a una persona y pedirle el PIN (se verifica en la PC, sin internet). */
function PickUser({ title, only, onPicked }: { title: string; only: (u: PosUser) => boolean; onPicked: (u: PosUser) => void }) {
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
        <h2>{title}</h2>
        <div className="user-tiles">
          {users.filter(only).map((u) => (
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

/** Fichar entrada o salida en la caja: se elige la persona, pone su PIN y listo (anda sin internet). */
function ClockModal({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const [who, setWho] = useState<PosUser | null>(null);
  const [last, setLast] = useState<Record<string, 'in' | 'out'>>({});
  useEffect(() => {
    void kvGet<Record<string, 'in' | 'out'>>('clockLast').then((v) => setLast(v ?? {}));
  }, []);
  const clock = async (action: 'in' | 'out') => {
    if (!who) return;
    const occurredAt = nowIso();
    await enqueue({ id: uuid(), type: 'CLOCK', userId: who.id, occurredAt, action });
    await kvSet('clockLast', { ...last, [who.id]: action });
    toast(t(action === 'in' ? 'pos.clockedIn' : 'pos.clockedOut', { name: who.name, time: timeFmt(occurredAt) }));
    onClose();
  };
  // Se sugiere lo que corresponde según el último fichaje hecho en esta PC.
  const next = who && last[who.id] === 'in' ? 'out' : 'in';
  return (
    <Modal title={`🕘 ${t('pos.clockInOut')}`} onClose={onClose}>
      {!who ? (
        <PickUser title={t('pos.clockWho')} only={(u) => u.role !== 'OWNER'} onPicked={setWho} />
      ) : (
        <div className="stack">
          <h2>{who.name}</h2>
          <button className={`big ${next === 'in' ? 'primary' : ''}`} onClick={() => void clock('in')}>
            ▶ {t('pos.clockIn')}
          </button>
          <button className={`big ${next === 'out' ? 'primary' : ''}`} onClick={() => void clock('out')}>
            ⏹ {t('pos.clockOut')}
          </button>
        </div>
      )}
    </Modal>
  );
}

/** Pago a proveedor, gasto, retiro o ingreso de cambio: queda anotado para que el cierre dé bien. */
function CashMoveModal({ session, cashier, onClose }: { session: CashSessionLocal; cashier: PosUser; onClose: () => void }) {
  const { t } = useTranslation();
  const [kind, setKind] = useState<CashMoveKind>('SUPPLIER');
  const [amount, setAmount] = useState('');
  const [supplierId, setSupplierId] = useState('');
  const [reason, setReason] = useState('');
  const [suppliers, setSuppliers] = useState<SupplierRow[]>([]);
  useEffect(() => {
    void kvGet<SupplierRow[]>('suppliers').then((s) => setSuppliers(s ?? []));
  }, []);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const n = toNum(amount);
    if (!n || n <= 0) return;
    const id = uuid();
    const occurredAt = nowIso();
    const supplier = kind === 'SUPPLIER' ? suppliers.find((s) => s.id === supplierId) : undefined;
    const why = reason.trim() || undefined;
    await enqueue({ id, type: 'CASH_MOVE', userId: cashier.id, occurredAt, cashSessionId: session.id, kind, amount: n, reason: why, supplierId: supplier?.id ?? null });
    const key = `cashMoves:${session.id}`;
    await kvSet(key, [...((await kvGet<CashMoveLocal[]>(key)) ?? []), { id, kind, amount: n, reason: why, supplierName: supplier?.name, occurredAt }]);
    toast(t('pos.moveSaved', { amount: money(n) }));
    onClose();
  };
  return (
    <Modal title={`💸 ${t('pos.cashMove')}`} onClose={onClose}>
      <form className="stack" onSubmit={(e) => void submit(e)}>
        <div className="grid2">
          {CASH_MOVE_KINDS.map((k) => (
            <label key={k} className="check">
              <input type="radio" name="kind" checked={kind === k} onChange={() => setKind(k)} /> {t(`pos.moveKinds.${k}`)}
            </label>
          ))}
        </div>
        <Field label={t('pos.amount')}>
          <input autoFocus inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} style={{ fontSize: '1.4rem' }} required />
        </Field>
        {kind === 'SUPPLIER' && suppliers.length > 0 && (
          <Field label={t('products.supplier')}>
            <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
              <option value="">—</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </Field>
        )}
        <Field label={t('common.reason')}>
          <input value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} />
        </Field>
        <button className="primary big">{t('common.save')}</button>
      </form>
    </Modal>
  );
}

function OpenCash({ cashier, onOpened, onBack }: { cashier: PosUser; onOpened: (s: CashSessionLocal) => void; onBack: () => void }) {
  const { t } = useTranslation();
  const [amount, setAmount] = useState('');
  const [handover, setHandover] = useState<Handover | null>(null);
  useEffect(() => {
    void kvGet<Handover>('handover').then((h) => setHandover(h && Date.now() - new Date(h.closedAt).getTime() < 36 * 3_600_000 ? h : null));
  }, []);
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
      {handover && (
        <div className="handover">
          <strong>🔁 {t('pos.handoverFrom', { name: handover.user, time: timeFmt(handover.closedAt) })}</strong>
          <p>{handover.notes}</p>
        </div>
      )}
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
  const [clocking, setClocking] = useState(false);
  const [moving, setMoving] = useState(false);
  const [short, setShort] = useState(false);
  /** Avisa al dueño que se está terminando (queda en la cola: anda sin internet). */
  const reportShortage = async (productId: string, name: string) => {
    await enqueue({ id: uuid(), type: 'SHORTAGE', userId: cashier.id, occurredAt: nowIso(), productId });
    toast(t('pos.shortageSent', { name }));
  };
  const [recent, setRecent] = useState<LocalSale[]>([]);
  const [printing, setPrinting] = useState<LocalSale | null>(null);
  const [catalogCount, setCatalogCount] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const canOverride = cashier.role === 'OWNER' || cashier.perms.includes('prices');
  // En pantallas táctiles no se pone el cursor solo: abriría el teclado en cada toque.
  const focus = () => setTimeout(() => !TOUCH && inputRef.current?.focus(), 0);
  const [pane, setPane] = useState<'products' | 'cart'>('products');
  const pick = (p: CatalogProduct) => (p.unit === 'KG' ? setWeightFor(p) : add(p, 1));

  // Cuentas de mesa: la que está elegida recibe lo que se agrega; si no hay ninguna, es venta directa.
  const [tabs, setTabs] = useState<LocalTab[]>([]);
  const [tabId, setTabId] = useState<string | null>(null);
  const [openingTab, setOpeningTab] = useState(false);
  const tab = tabs.find((x) => x.id === tabId) ?? null;
  const ticket: CartItem[] = tab ? tab.items.map((i) => ({ productId: i.productId, name: i.name, unit: i.unit ?? 'UNIT', qty: i.qty, listPrice: i.unitPrice })) : items;
  useEffect(() => {
    const tick = () => void refreshTabs().catch(() => undefined);
    tick();
    const timer = setInterval(tick, 8000);
    return () => clearInterval(timer);
  }, []);

  const loadSide = useCallback(async () => {
    setTabs(await db.tabs.toArray());
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

  const lines = useMemo(() => priceCart(ticket, offers), [ticket, offers]);
  const total = cartTotal(lines);

  /** Anota en la cuenta de la mesa elegida (queda guardado y se manda al servidor). */
  const setTab = async (p: { id: string; name: string; price: number; unit: 'UNIT' | 'KG' }, qty: number) => {
    if (!tab) return;
    await setTabQty(cashier.id, tab.id, p, qty);
    setTabs(await db.tabs.toArray());
  };
  const add = (p: CatalogProduct, qty: number) => {
    if (tab) void setTab(p, (tab.items.find((i) => i.productId === p.id)?.qty ?? 0) + qty);
    else setItems((prev) => addItem(prev, p, qty));
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
    const inTab = tab?.items.find((i) => i.productId === productId);
    if (tab && inTab) {
      void setTab({ id: productId, name: inTab.name, price: inTab.unitPrice, unit: inTab.unit ?? 'UNIT' }, 0);
      void enqueue({ id: uuid(), type: 'ITEM_REMOVED', userId: cashier.id, occurredAt: nowIso(), cashSessionId: session.id, productId, qty: inTab.qty, amount: round2(inTab.qty * inTab.unitPrice) });
      return focus();
    }
    const it = items.find((x) => x.productId === productId && (x.overridePrice != null) === overridden);
    if (!it) return;
    setItems((prev) => prev.filter((x) => x !== it));
    void enqueue({ id: uuid(), type: 'ITEM_REMOVED', userId: cashier.id, occurredAt: nowIso(), cashSessionId: session.id, productId, qty: it.qty, amount: round2(it.qty * (it.overridePrice ?? it.listPrice)) });
    focus();
  };

  const changeQty = (productId: string, delta: number) => {
    const inTab = tab?.items.find((i) => i.productId === productId);
    if (inTab) return void setTab({ id: productId, name: inTab.name, price: inTab.unitPrice, unit: inTab.unit ?? 'UNIT' }, Math.max(1, inTab.qty + delta));
    setItems((prev) => prev.map((x) => (x.productId === productId && x.overridePrice == null ? { ...x, qty: Math.max(1, x.qty + delta) } : x)));
  };

  const override = (productId: string) => {
    const v = toNum(window.prompt(t('pos.overridePrice')) ?? '');
    if (v == null || v < 0) return;
    setItems((prev) => prev.map((x) => (x.productId === productId ? { ...x, overridePrice: v } : x)));
    focus();
  };

  const clearCart = () => {
    if (tab) {
      // Vaciar una mesa = cancelarla (queda registrado).
      if (!window.confirm(t('tabs.cancelConfirm', { label: tab.label }))) return;
      void cancelTab(cashier.id, tab.id).then(loadSide);
      setTabId(null);
      return;
    }
    if (items.length === 0) return;
    for (const it of items) {
      void enqueue({ id: uuid(), type: 'ITEM_REMOVED', userId: cashier.id, occurredAt: nowIso(), cashSessionId: session.id, productId: it.productId, qty: it.qty, amount: round2(it.qty * (it.overridePrice ?? it.listPrice)) });
    }
    setItems([]);
    focus();
  };

  const confirmSale = async (payments: Pay[], change: number) => {
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
      tabId: tab?.id ?? null,
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
    if (tab) await db.tabs.delete(tab.id);
    await enqueue(event);
    const old = await db.sales.orderBy('occurredAt').reverse().offset(300).primaryKeys();
    if (old.length) await db.sales.bulkDelete(old);
    if (tab) setTabId(null);
    else setItems([]);
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

  // El teclado lee el estado de este render (se actualiza antes de pintar): así F12 nunca ve un carrito viejo.
  const keys = useRef({ blocked: false, hasTicket: false, escape: () => {}, scan: (_code: string) => {} });
  keys.current = {
    blocked: !!(paying || done || closing || weightFor || clocking || moving || short || openingTab),
    hasTicket: ticket.length > 0,
    escape: () => (results ? setResults(null) : clearCart()),
    scan: (code) => void onScan(code),
  };
  const scanBuf = useRef({ text: '', at: 0 });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const k = keys.current;
      if (k.blocked) return;
      // Un lector "teclea" muy rápido y termina con Enter: se toma aunque no haya un campo con el cursor.
      const el = e.target as HTMLElement | null;
      if (!el || !['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)) {
        const b = scanBuf.current;
        if (e.timeStamp - b.at > 80) b.text = '';
        b.at = e.timeStamp;
        if (e.key === 'Enter' && b.text.length >= 3) {
          e.preventDefault();
          k.scan(b.text);
          b.text = '';
          return;
        }
        if (e.key.length === 1) b.text += e.key;
      }
      if (e.key === 'F2') {
        e.preventDefault();
        inputRef.current?.focus();
      } else if (e.key === 'F12' && k.hasTicket) {
        e.preventDefault();
        setPaying(true);
      } else if (e.key === 'Escape') {
        k.escape();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="pos" data-pane={pane}>
      <div className="pos-left">
        <div className="pos-top no-print">
          <strong className="grow">🏪 {store?.name}</strong>
          <span>{cashier.name}</span>
          {props.status}
          <button onClick={() => setClocking(true)}>🕘 {t('pos.clock')}</button>
          <button onClick={() => setMoving(true)}>💸 {t('pos.cashMove')}</button>
          <button onClick={() => setShort(true)}>📣 {t('pos.shortage')}</button>
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
          <div className="row" style={{ flexWrap: 'nowrap' }}>
            <input ref={inputRef} autoFocus={!TOUCH} value={input} onChange={(e) => setInput(e.target.value)} placeholder={t('pos.scanHere')} />
            <ScanButton onCode={(code) => void onScan(code)} />
          </div>
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
        <QuickKeys onPick={pick} />
      </div>
      <div className="pos-right no-print">
        <div className="pos-tickets">
          <button type="button" className={!tab ? 'active' : ''} onClick={() => setTabId(null)}>
            🧾 {t('tabs.direct')}
          </button>
          {tabs.map((x) => (
            <button type="button" key={x.id} className={x.id === tabId ? 'active' : ''} onClick={() => setTabId(x.id)}>
              {x.label}
              {x.pending.length > 0 && <span className="pill-count">{x.pending.length}</span>}
            </button>
          ))}
          <button type="button" onClick={() => setOpeningTab(true)}>
            ＋ {t('tabs.open')}
          </button>
        </div>
        {tab && (
          <div className="muted small">
            {t('tabs.openedAt', { time: timeFmt(tab.openedAt) })} · {t('tabs.addHint')}
          </div>
        )}
        <div className="pos-cart">
          {lines.length === 0 && <p className="muted">{tab ? t('tabs.empty') : t('pos.emptyCart')}</p>}
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
                {canOverride && !l.priceOverride && !tab && (
                  <button className="small ghost" title={t('pos.overridePrice')} onClick={() => override(l.productId)}>
                    $
                  </button>
                )}
                <button className="small ghost" title={t('pos.shortage')} aria-label={t('pos.shortage')} onClick={() => void reportShortage(l.productId, l.name)}>
                  📣
                </button>
                <button className="small ghost" onClick={() => removeLine(l.productId, l.priceOverride)}>
                  ✕
                </button>
              </div>
            </div>
          ))}
        </div>
        <div className="pos-total">{money(total)}</div>
        <button className="primary big" disabled={!ticket.length} onClick={() => setPaying(true)}>
          {tab ? t('tabs.pay', { label: tab.label }) : `${t('pos.pay')} (F12)`}
        </button>
        <button disabled={!tab && !items.length} onClick={clearCart}>
          {tab ? t('tabs.cancel') : t('pos.clearCart')}
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

      <div className="pos-mobile-bar no-print">
        <button type="button" className={pane === 'products' ? 'active' : ''} onClick={() => setPane('products')}>
          🛍 {t('pos.paneProducts')}
        </button>
        <button type="button" className={pane === 'cart' ? 'active' : ''} onClick={() => setPane('cart')}>
          🧾 {tab ? `${tab.label} (${ticket.length})` : t('pos.paneCart', { count: items.length })} · <strong>{money(total)}</strong>
        </button>
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
      {paying && (
        <PayModal
          total={total}
          mp={!!store?.mp}
          table={tab?.table ?? null}
          label={tab?.label ?? null}
          onClose={() => (setPaying(false), focus())}
          onConfirm={confirmSale}
        />
      )}
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
      {closing && <CloseCash session={session} cashier={cashier} recent={recent} openTabs={tabs.length} onClose={() => setClosing(false)} onClosed={props.onClosed} />}
      {openingTab && (
        <OpenTabModal
          tables={store?.settings.tables ?? 0}
          taken={tabs.map((x) => x.table).filter((n): n is number => n != null)}
          onClose={() => setOpeningTab(false)}
          onOpen={async (label, table) => {
            const created = await openTab(cashier.id, label, table);
            setTabs(await db.tabs.toArray());
            setTabId(created.id);
            setOpeningTab(false);
          }}
        />
      )}
      {clocking && <ClockModal onClose={() => (setClocking(false), focus())} />}
      {moving && <CashMoveModal session={session} cashier={cashier} onClose={() => (setMoving(false), focus())} />}
      {short && (
        <ShortageModal
          onPick={(p) => void reportShortage(p.id, p.name)}
          onClose={() => (setShort(false), focus())}
        />
      )}
      {printing && <Ticket sale={printing} store={store} />}
    </div>
  );
}

const TOUCH = typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches;
const TINTS = ['#fde2e4', '#e2ece9', '#fff1c1', '#dfe7fd', '#f0e6ff', '#e8f5d6', '#ffe5cc'];
const tint = (id?: string | null) => (id ? TINTS[[...id].reduce((s, c) => s + c.charCodeAt(0), 0) % TINTS.length] : '#fff');

/** Botones rápidos de la pantalla táctil, por categoría: lo que no tiene código o se vende todo el tiempo. */
function QuickKeys({ onPick }: { onPick: (p: CatalogProduct) => void }) {
  const { t } = useTranslation();
  const [keys, setKeys] = useState<CatalogProduct[]>([]);
  const [cats, setCats] = useState<CategoryRow[]>([]);
  const [cat, setCat] = useState('');
  const load = useCallback(async () => {
    setKeys((await db.products.filter((p) => p.active && !!p.quickKey).toArray()).sort((a, b) => a.name.localeCompare(b.name)));
    setCats((await kvGet<CategoryRow[]>('categories')) ?? []);
  }, []);
  useEffect(() => {
    void load();
    syncEvents.addEventListener('change', load);
    return () => syncEvents.removeEventListener('change', load);
  }, [load]);
  if (keys.length === 0) return <p className="hint pos-quick">{t('pos.noQuickKeys')}</p>;
  const used = cats.filter((c) => keys.some((k) => k.categoryId === c.id));
  const shown = cat ? keys.filter((k) => k.categoryId === cat) : keys;
  return (
    <div className="pos-quick">
      {used.length > 1 && (
        <div className="pos-quick-cats">
          <button type="button" className={cat === '' ? 'active' : ''} onClick={() => setCat('')}>
            {t('pos.quickAll')}
          </button>
          {used.map((c) => (
            <button type="button" key={c.id} className={cat === c.id ? 'active' : ''} onClick={() => setCat(c.id)}>
              {c.name}
            </button>
          ))}
        </div>
      )}
      <div className="pos-quick-grid">
        {shown.map((p) => (
          <button key={p.id} type="button" className="pos-key" style={{ background: tint(p.categoryId) }} onClick={() => onPick(p)}>
            <span className="n">{p.name}</span>
            <strong>
              {money(p.price)}
              {p.unit === 'KG' ? '/kg' : ''}
            </strong>
          </button>
        ))}
      </div>
    </div>
  );
}

/** Abrir una cuenta: una mesa libre o un nombre (barra, cliente conocido). */
function OpenTabModal({ tables, taken, onOpen, onClose }: { tables: number; taken: number[]; onOpen: (label: string, table: number | null) => void; onClose: () => void }) {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  return (
    <Modal title={`🍺 ${t('tabs.open')}`} onClose={onClose}>
      <div className="stack">
        {tables > 0 && (
          <div className="pos-tables">
            {Array.from({ length: tables }, (_, i) => i + 1).map((n) => (
              <button type="button" key={n} disabled={taken.includes(n)} onClick={() => onOpen(t('tabs.table', { n }), n)}>
                {t('tabs.table', { n })}
              </button>
            ))}
          </div>
        )}
        <form
          className="row"
          style={{ flexWrap: 'nowrap' }}
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) onOpen(name.trim(), null);
          }}
        >
          <input placeholder={t('tabs.namePlaceholder')} value={name} maxLength={40} onChange={(e) => setName(e.target.value)} />
          <button className="primary" disabled={!name.trim()}>
            {t('tabs.openNamed')}
          </button>
        </form>
      </div>
    </Modal>
  );
}

/** Buscar en el catálogo de la caja qué producto se está terminando. */
function ShortageModal({ onPick, onClose }: { onPick: (p: CatalogProduct) => void; onClose: () => void }) {
  const { t } = useTranslation();
  const [term, setTerm] = useState('');
  const [list, setList] = useState<CatalogProduct[]>([]);
  useEffect(() => {
    const q = normalize(term.trim());
    if (q.length < 2) return setList([]);
    void db.products
      .filter((p) => p.active && p.search.includes(q))
      .limit(8)
      .toArray()
      .then(setList);
  }, [term]);
  return (
    <Modal title={`📣 ${t('pos.shortage')}`} onClose={onClose}>
      <div className="stack">
        <p className="muted small">{t('pos.shortageHelp')}</p>
        <input autoFocus placeholder={t('pos.shortageSearch')} value={term} onChange={(e) => setTerm(e.target.value)} />
        {list.map((p) => (
          <button
            key={p.id}
            type="button"
            className="pos-line"
            style={{ width: '100%', textAlign: 'left' }}
            onClick={() => {
              onPick(p);
              onClose();
            }}
          >
            <span className="n">{p.name}</span>
            <span className="muted small">{p.barcode}</span>
            <span />
            <span>📣</span>
          </button>
        ))}
      </div>
    </Modal>
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

type Pay = { method: PaymentMethod; amount: number; ref?: string };

function PayModal({
  total,
  mp,
  table,
  label,
  onClose,
  onConfirm,
}: {
  total: number;
  /** Mercado Pago conectado: con "QR" se cobra con el monto cargado en el QR de la mesa o del mostrador. */
  mp: boolean;
  table: number | null;
  label: string | null;
  onClose: () => void;
  onConfirm: (p: Pay[], change: number) => void;
}) {
  const { t } = useTranslation();
  const [rows, setRows] = useState<{ method: PaymentMethod; amount: string }[]>([{ method: 'CASH', amount: String(total) }]);
  const parsed = rows.map((r) => ({ method: r.method, amount: toNum(r.amount) ?? 0 }));
  const { payments, change, missing } = settlePayments(total, parsed);
  const setRow = (i: number, patch: Partial<{ method: PaymentMethod; amount: string }>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const bills = [...new Set([total, Math.ceil(total / 1000) * 1000, Math.ceil(total / 2000) * 2000, Math.ceil(total / 10000) * 10000])];
  const mpQr = mp && rows.length === 1 && rows[0].method === 'QR';
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!mpQr && missing <= 0) onConfirm(payments as Pay[], change);
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
        {mpQr ? (
          <MpQrCharge amount={total} table={table} label={label} onPaid={(ref) => onConfirm([{ method: 'QR', amount: total, ref }], 0)} />
        ) : (
          <button className="primary big" disabled={missing > 0}>
            {t('pos.confirmSale')}
          </button>
        )}
      </form>
    </Modal>
  );
}

interface ChargeView {
  chargeId: string;
  orderId: string | null;
  status: string;
  paid: boolean;
}

/**
 * Cobro con el QR fijo de Mercado Pago: se manda el monto al QR de la mesa (o del mostrador), el cliente
 * escanea y paga, y la caja se entera sola. Necesita internet.
 */
function MpQrCharge({ amount, table, label, onPaid }: { amount: number; table: number | null; label: string | null; onPaid: (ref: string) => void }) {
  const { t } = useTranslation();
  const [charge, setCharge] = useState<ChargeView | null>(null);
  const [state, setState] = useState<'idle' | 'waiting' | 'failed'>('idle');
  const [error, setError] = useState('');
  const done = useRef(false);
  const paid = useRef(onPaid);
  paid.current = onPaid;
  const where = table != null ? t('tabs.table', { n: table }) : t('mp.counter');

  const start = async () => {
    setError('');
    setState('waiting');
    try {
      setCharge(await posPost<ChargeView>('/pos/mp/charges', { chargeId: uuid(), amount, table, description: label ?? t('mp.counter') }));
    } catch {
      setState('failed');
      setError(navigator.onLine ? t('mp.chargeError') : t('mp.offline'));
    }
  };
  useEffect(() => {
    if (state !== 'waiting' || !charge) return;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      try {
        const c = await posGet<ChargeView>(`/pos/mp/charges/${charge.chargeId}`);
        if (c.paid && !done.current) {
          done.current = true;
          return paid.current(c.orderId ?? c.chargeId);
        }
        if (['canceled', 'expired', 'failed'].includes(c.status)) {
          setState('failed');
          return setError(t('mp.notPaid'));
        }
      } catch {
        // sin conexión un momento: se sigue esperando
      }
      timer = setTimeout(() => void tick(), 2000);
    };
    timer = setTimeout(() => void tick(), 1500);
    return () => clearTimeout(timer);
  }, [state, charge, t]);

  const cancel = async () => {
    if (charge) await posPost(`/pos/mp/charges/${charge.chargeId}/cancel`).catch(() => undefined);
    setCharge(null);
    setState('idle');
  };

  if (state === 'waiting') {
    return (
      <div className="mp-wait">
        <div className="spinner" />
        <strong>{t('mp.waiting', { where })}</strong>
        <span className="muted small">{t('mp.waitingHelp')}</span>
        <button type="button" onClick={() => void cancel()}>
          {t('common.cancel')}
        </button>
      </div>
    );
  }
  return (
    <>
      {error && <p className="error">{error}</p>}
      <button type="button" className="primary big" onClick={() => void start()}>
        📱 {t('mp.chargeAt', { where })}
      </button>
    </>
  );
}

function CloseCash({
  session,
  cashier,
  recent,
  openTabs,
  onClose,
  onClosed,
}: {
  session: CashSessionLocal;
  cashier: PosUser;
  recent: LocalSale[];
  openTabs: number;
  onClose: () => void;
  onClosed: () => void;
}) {
  const { t } = useTranslation();
  const [counted, setCounted] = useState('');
  const [notes, setNotes] = useState('');
  const [result, setResult] = useState<{ expected: number; counted: number } | null>(null);
  const [moves, setMoves] = useState<CashMoveLocal[]>([]);
  useEffect(() => {
    void kvGet<CashMoveLocal[]>(`cashMoves:${session.id}`).then((m) => setMoves(m ?? []));
  }, [session.id]);
  const cashSales = round2(recent.filter((s) => !s.voided).reduce((sum, s) => sum + s.payments.filter((p) => p.method === 'CASH').reduce((a, p) => a + p.amount, 0), 0));
  const out = round2(moves.filter((m) => cashMoveSign(m.kind) < 0).reduce((s, m) => s + m.amount, 0));
  const inflow = round2(moves.filter((m) => cashMoveSign(m.kind) > 0).reduce((s, m) => s + m.amount, 0));
  // Esperado = inicial + ventas en efectivo − pagos/gastos/retiros + cambio agregado.
  const expected = round2(session.openingAmount + cashSales - out + inflow);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const c = toNum(counted) ?? 0;
    const note = notes.trim();
    const occurredAt = nowIso();
    await enqueue({ id: uuid(), type: 'CASH_CLOSE', userId: cashier.id, occurredAt, cashSessionId: session.id, countedAmount: c, ...(note ? { notes: note } : {}) });
    if (note) await kvSet('handover', { notes: note, user: cashier.name, closedAt: occurredAt } satisfies Handover);
    await kvDel('cashSession');
    await kvDel(`cashMoves:${session.id}`);
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
        {openTabs > 0 && <p className="warn small">🍺 {t('tabs.openAtClose', { count: openTabs })}</p>}
        <table className="small">
          <tbody>
            <tr>
              <td>{t('pos.openingAmount')}</td>
              <td className="num">{money(session.openingAmount)}</td>
            </tr>
            <tr>
              <td>+ {t('pos.cashSales')}</td>
              <td className="num">{money(cashSales)}</td>
            </tr>
            {out > 0 && (
              <tr>
                <td>− {t('pos.moveOut')}</td>
                <td className="num">{money(out)}</td>
              </tr>
            )}
            {inflow > 0 && (
              <tr>
                <td>+ {t('pos.moveKinds.DEPOSIT')}</td>
                <td className="num">{money(inflow)}</td>
              </tr>
            )}
            <tr>
              <th>{t('pos.expected')}</th>
              <th className="num">{money(expected)}</th>
            </tr>
          </tbody>
        </table>
        <Field label={t('pos.countedAmount')}>
          <input autoFocus inputMode="decimal" value={counted} onChange={(e) => setCounted(e.target.value)} style={{ fontSize: '1.4rem' }} required />
        </Field>
        <Field label={t('pos.handoverNotes')} hint={t('pos.handoverHint')}>
          <textarea rows={3} maxLength={500} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
        <button className="primary big">{t('pos.closeCash')}</button>
      </form>
    </Modal>
  );
}

function Ticket({ sale, store }: { sale: LocalSale; store: StoreInfo | null }) {
  // El ticket es para el cliente: siempre en español, aunque la caja esté en chino.
  const { t } = useTranslation(undefined, { lng: 'es' });
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
