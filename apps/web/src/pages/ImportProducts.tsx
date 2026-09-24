import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api, errMsg } from '../api';
import { Field, toast } from '../components/ui';
import { money, qtyFmt, todayISO } from '../lib/format';
import { buildRows, type Cell, guessMapping, IMPORT_FIELDS, type Mapping, readTable, templateCsv } from '../lib/sheet';

interface Result {
  created: number;
  updated: number;
  unchanged: number;
  stockLines: number;
  errors: { row: number; error: string }[];
}

/** Importar el catálogo desde Excel o CSV: se eligen las columnas, se revisa y se importa en tandas. */
export function ImportProducts() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [fileName, setFileName] = useState('');
  const [table, setTable] = useState<Cell[][] | null>(null);
  const [mapping, setMapping] = useState<Mapping | null>(null);
  const [updatePrices, setUpdatePrices] = useState(true);
  const [addStock, setAddStock] = useState(true);
  const [progress, setProgress] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);

  const onFile = async (f: File) => {
    try {
      const tb = await readTable(f);
      if (tb.length < 2) return toast(t('importer.empty'));
      setFileName(f.name);
      setTable(tb);
      setMapping(guessMapping(tb[0]));
      setResult(null);
    } catch {
      toast(t('importer.unreadable'));
    }
  };

  const downloadTemplate = () => {
    const url = URL.createObjectURL(templateCsv());
    const a = document.createElement('a');
    a.href = url;
    a.download = 'plantilla-productos.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const all = table && mapping ? buildRows(table, mapping) : null;

  const run = async () => {
    if (!all) return;
    const total: Result = { created: 0, updated: 0, unchanged: 0, stockLines: 0, errors: all.brokenBarcodes.map((row) => ({ row, error: 'broken_barcode' })) };
    const rows = all.rows;
    try {
      for (let i = 0; i < rows.length; i += 300) {
        setProgress(t('importer.progress', { done: Math.min(i + 300, rows.length), total: rows.length }));
        const r = await api<Result>('/products/import', { body: { rows: rows.slice(i, i + 300), updatePrices, addStock } });
        total.created += r.created;
        total.updated += r.updated;
        total.unchanged += r.unchanged;
        total.stockLines += r.stockLines;
        total.errors.push(...r.errors);
      }
      setResult(total);
      void qc.invalidateQueries({ queryKey: ['products'] });
    } catch (e) {
      toast(errMsg(e));
    } finally {
      setProgress(null);
    }
  };

  return (
    <div className="stack">
      <Link to="/products">← {t('products.title')}</Link>
      <h1>{t('importer.title')}</h1>
      <div className="card stack">
        <p className="muted">{t('importer.help')}</p>
        <div className="row">
          <label className="btn btn-primary">
            📄 {t('importer.chooseFile')}
            <input type="file" accept=".xlsx,.csv,.txt" hidden onChange={(e) => e.target.files?.[0] && void onFile(e.target.files[0])} />
          </label>
          <button type="button" className="ghost" onClick={downloadTemplate}>
            ⬇️ {t('importer.template')}
          </button>
          {fileName && <span className="muted small">{fileName}</span>}
        </div>
      </div>

      {table && mapping && all && (
        <>
          <div className="card stack">
            <h2>{t('importer.columns')}</h2>
            <div className="grid2">
              {IMPORT_FIELDS.map((f) => (
                <Field key={f} label={t(`importer.fields.${f}`)}>
                  <select value={mapping[f]} onChange={(e) => setMapping({ ...mapping, [f]: Number(e.target.value) })}>
                    <option value={-1}>{t('importer.none')}</option>
                    {table[0].map((h, i) => (
                      <option key={i} value={i}>
                        {String(h ?? `#${i + 1}`)}
                      </option>
                    ))}
                  </select>
                </Field>
              ))}
            </div>
          </div>

          <div className="card table-wrap">
            <h2>{t('importer.preview')}</h2>
            <table>
              <thead>
                <tr>
                  <th>{t('importer.fields.barcode')}</th>
                  <th>{t('importer.fields.name')}</th>
                  <th className="num">{t('importer.fields.price')}</th>
                  <th className="num">{t('importer.fields.cost')}</th>
                  <th className="num">{t('importer.fields.stock')}</th>
                  <th>{t('importer.fields.category')}</th>
                </tr>
              </thead>
              <tbody>
                {all.rows.slice(0, 6).map((r) => (
                  <tr key={r.row}>
                    <td className="small">{r.barcode}</td>
                    <td>{r.name}</td>
                    <td className="num">{r.price != null ? money(r.price) : '—'}</td>
                    <td className="num">{r.cost != null ? money(r.cost) : '—'}</td>
                    <td className="num">{r.stock != null ? qtyFmt(r.stock) : '—'}</td>
                    <td className="small">{r.category}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="card stack">
            <label className="check">
              <input type="checkbox" checked={updatePrices} onChange={(e) => setUpdatePrices(e.target.checked)} /> {t('importer.updatePrices')}
            </label>
            {mapping.stock >= 0 && (
              <label className="check">
                <input type="checkbox" checked={addStock} onChange={(e) => setAddStock(e.target.checked)} /> {t('importer.addStock')}
              </label>
            )}
            <button className="primary big" disabled={!!progress || all.rows.length === 0 || mapping.name < 0} onClick={() => void run()}>
              {progress ?? t('importer.import', { count: all.rows.length })}
            </button>
          </div>
        </>
      )}

      {result && (
        <div className="card stack" style={{ borderLeft: '4px solid var(--ok)' }}>
          <strong>{t('importer.done', { created: result.created, updated: result.updated, unchanged: result.unchanged })}</strong>
          {result.stockLines > 0 && <span>{t('importer.stockAdded', { count: result.stockLines })}</span>}
          {result.errors.slice(0, 30).map((e) => (
            <span key={`${e.row}${e.error}`} className="small error">
              {t('importer.rowError', { row: e.row, error: t(`importer.errors.${e.error as 'missing_name'}`) })}
            </span>
          ))}
          <div className="row">
            <Link className="btn" to="/products">
              {t('products.title')}
            </Link>
            <Link className="btn btn-primary" to={`/labels?since=${todayISO()}`}>
              🏷️ {t('importer.printLabels')}
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
