import { type FormEvent, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api, ApiError, errMsg } from '../api';
import { Empty, ErrorBox, Field, Loading, toast, toNum } from '../components/ui';
import { useSuppliers } from '../lib/hooks';
import type { Supplier } from '../lib/types';

/** Lista de proveedores: nombre, WhatsApp (para los pedidos) y días de entrega. */
export function Suppliers() {
  const { t } = useTranslation();
  const q = useSuppliers();
  return (
    <div className="stack">
      <Link to="/products">← {t('products.title')}</Link>
      <h1>{t('products.suppliers')}</h1>
      <p className="muted">{t('products.suppliersHelp')}</p>
      {q.isLoading && <Loading />}
      <ErrorBox error={q.error} />
      {q.data?.length === 0 && <Empty />}
      {q.data?.map((s) => <SupplierForm key={s.id} supplier={s} />)}
      <h2>{t('products.newSupplier')}</h2>
      <SupplierForm />
    </div>
  );
}

function SupplierForm({ supplier }: { supplier?: Supplier }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const empty = { name: '', phone: '', leadTimeDays: '3' };
  const [f, setF] = useState(supplier ? { name: supplier.name, phone: supplier.phone ?? '', leadTimeDays: String(supplier.leadTimeDays) } : empty);
  const [busy, setBusy] = useState(false);
  const refresh = () => void qc.invalidateQueries({ queryKey: ['suppliers'] });

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const body = { name: f.name, phone: f.phone || null, leadTimeDays: toNum(f.leadTimeDays) ?? 3 };
      if (supplier) await api(`/suppliers/${supplier.id}`, { method: 'PATCH', body });
      else {
        await api('/suppliers', { body });
        setF(empty);
      }
      toast(t('common.saved'));
      refresh();
    } catch (err) {
      toast(err instanceof ApiError && err.code === 'supplier_exists' ? t('products.supplierExists') : errMsg(err));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!supplier || !window.confirm(t('products.deleteSupplier'))) return;
    try {
      await api(`/suppliers/${supplier.id}`, { method: 'DELETE' });
      refresh();
      void qc.invalidateQueries({ queryKey: ['products'] });
    } catch (err) {
      toast(errMsg(err));
    }
  };

  return (
    <form className="card stack" onSubmit={save}>
      {supplier && (
        <div className="row between">
          <strong>{supplier.name}</strong>
          <span className="muted small">{t('products.productsCount', { count: supplier.products ?? 0 })}</span>
        </div>
      )}
      <div className="grid2">
        <Field label={t('common.name')}>
          <input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required />
        </Field>
        <Field label={t('products.phone')}>
          <input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} inputMode="tel" placeholder="5491122334455" />
        </Field>
        <Field label={t('products.leadTime')}>
          <input value={f.leadTimeDays} onChange={(e) => setF({ ...f, leadTimeDays: e.target.value })} inputMode="numeric" />
        </Field>
      </div>
      <div className="row">
        <button className="primary" disabled={busy}>
          {supplier ? t('common.save') : t('common.add')}
        </button>
        {supplier && (
          <button type="button" className="danger" onClick={() => void remove()}>
            {t('common.delete')}
          </button>
        )}
      </div>
    </form>
  );
}
