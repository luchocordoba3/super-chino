import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api, errMsg } from '../api';
import { ErrorBox, Field, Loading, toast } from '../components/ui';
import { shrinkToDataUrl } from '../lib/image';
import type { Business, SiteContent } from '../lib/types';

async function upload(file: File, kind: 'site' | 'logo') {
  const dataUrl = await shrinkToDataUrl(file, kind === 'logo' ? 600 : 1800);
  return api<{ id: string; url: string }>('/assets', { body: { dataUrl, kind } });
}

function ImagePick({ value, onChange, label }: { value?: string | null; onChange: (url: string | null) => void; label: string }) {
  const [busy, setBusy] = useState(false);
  return (
    <div className="img-pick">
      {value ? <img src={value} alt="" /> : <div className="img-empty">Sin imagen</div>}
      <div className="row wrap">
        <label className="btn small">
          {busy ? 'Subiendo…' : value ? 'Cambiar' : label}
          <input
            type="file"
            accept="image/*"
            hidden
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              setBusy(true);
              try {
                onChange((await upload(file, 'site')).url);
              } catch (err) {
                toast(errMsg(err));
              } finally {
                setBusy(false);
              }
            }}
          />
        </label>
        {value && (
          <button type="button" className="link-btn small" onClick={() => onChange(null)}>
            Quitar
          </button>
        )}
      </div>
    </div>
  );
}

export default function MySite() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['business'], queryFn: () => api<Business>('/business') });
  const [s, setS] = useState<SiteContent | null>(null);
  const [logo, setLogo] = useState<string | null>(null);
  useEffect(() => {
    if (q.data && !s) {
      setS(q.data.site);
      setLogo(q.data.logoAssetId);
    }
  }, [q.data, s]);
  const save = useMutation({
    mutationFn: () => api<Business>('/business', { method: 'PATCH', body: { site: s, logoAssetId: logo } }),
    onSuccess: (b) => {
      qc.setQueryData(['business'], b);
      toast('Web actualizada');
    },
    onError: (e) => toast(errMsg(e)),
  });
  if (q.isLoading || !s) return q.error ? <ErrorBox error={q.error} /> : <Loading />;
  const set = <K extends keyof SiteContent>(k: K, v: SiteContent[K]) => setS({ ...s, [k]: v });
  const listSet = <K extends 'services' | 'gallery' | 'steps' | 'faqs'>(k: K, i: number, patch: Partial<SiteContent[K][number]>) =>
    set(k, s[k].map((x, j) => (j === i ? { ...x, ...patch } : x)) as SiteContent[K]);
  const listDel = (k: 'services' | 'gallery' | 'steps' | 'faqs', i: number) => set(k, s[k].filter((_, j) => j !== i) as never);

  return (
    <div className="stack">
      <div className="page-head">
        <h1>Mi web</h1>
        <div className="row wrap">
          <a className="btn" href={`/${q.data!.slug}`} target="_blank" rel="noreferrer">
            Ver mi web ↗
          </a>
          <button className="btn primary" type="button" disabled={save.isPending} onClick={() => save.mutate()}>
            Guardar
          </button>
        </div>
      </div>

      <section className="card">
        <h2>Portada</h2>
        <div className="form-grid">
          <Field label="Título" wide>
            <input value={s.headline} onChange={(e) => set('headline', e.target.value)} />
          </Field>
          <Field label="Bajada" wide>
            <textarea rows={2} value={s.subheadline} onChange={(e) => set('subheadline', e.target.value)} />
          </Field>
          <Field label="Color principal">
            <input type="color" value={s.primaryColor} onChange={(e) => set('primaryColor', e.target.value)} />
          </Field>
          <Field label="Color de acento">
            <input type="color" value={s.accentColor} onChange={(e) => set('accentColor', e.target.value)} />
          </Field>
        </div>
        <div className="form-grid">
          <Field label="Foto de portada">
            <ImagePick value={s.heroImage} onChange={(url) => set('heroImage', url)} label="Subir foto" />
          </Field>
          <Field label="Logo">
            <div className="img-pick">
              {logo ? <img src={`/api/assets/${logo}`} alt="" /> : <div className="img-empty">Sin logo</div>}
              <label className="btn small">
                {logo ? 'Cambiar' : 'Subir logo'}
                <input
                  type="file"
                  accept="image/*"
                  hidden
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (file) setLogo((await upload(file, 'logo')).id);
                  }}
                />
              </label>
            </div>
          </Field>
        </div>
        <label className="check">
          <input type="checkbox" checked={s.illustrativeImages} onChange={(e) => set('illustrativeImages', e.target.checked)} />
          Mostrar "Imágenes ilustrativas" (hasta que subas fotos de tus trabajos)
        </label>
      </section>

      <section className="card">
        <h2>Servicios</h2>
        <div className="edit-list">
          {s.services.map((x, i) => (
            <div key={i} className="edit-item">
              <ImagePick value={x.image} onChange={(url) => listSet('services', i, { image: url })} label="Foto" />
              <div className="stack grow">
                <input value={x.title} onChange={(e) => listSet('services', i, { title: e.target.value })} aria-label="Servicio" />
                <textarea rows={2} value={x.text} onChange={(e) => listSet('services', i, { text: e.target.value })} aria-label="Descripción" />
                <button type="button" className="link-btn small danger" onClick={() => listDel('services', i)}>
                  Quitar
                </button>
              </div>
            </div>
          ))}
        </div>
        <button type="button" className="btn small" onClick={() => set('services', [...s.services, { title: 'Nuevo servicio', text: '', image: null }])}>
          + Servicio
        </button>
      </section>

      <section className="card">
        <h2>Trabajos hechos</h2>
        <p className="muted small">Subí fotos de tus trabajos: es lo que más confianza da.</p>
        <div className="gallery-edit">
          {s.gallery.map((g, i) => (
            <figure key={i}>
              <img src={g.image} alt="" />
              <input value={g.caption} placeholder="Descripción" onChange={(e) => listSet('gallery', i, { caption: e.target.value })} aria-label="Descripción de la foto" />
              <button type="button" className="link-btn small danger" onClick={() => listDel('gallery', i)}>
                Quitar
              </button>
            </figure>
          ))}
        </div>
        <label className="btn small">
          + Fotos
          <input
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={async (e) => {
              const files = [...(e.target.files ?? [])];
              const added: SiteContent['gallery'] = [];
              for (const f of files) {
                try {
                  added.push({ image: (await upload(f, 'site')).url, caption: '' });
                } catch (err) {
                  toast(errMsg(err));
                }
              }
              setS((cur) => (cur ? { ...cur, gallery: [...cur.gallery, ...added] } : cur));
            }}
          />
        </label>
      </section>

      <section className="card">
        <h2>Cómo trabajamos</h2>
        {s.steps.map((x, i) => (
          <div key={i} className="form-grid">
            <Field label={`Paso ${i + 1}`}>
              <input value={x.title} onChange={(e) => listSet('steps', i, { title: e.target.value })} />
            </Field>
            <Field label="Detalle">
              <input value={x.text} onChange={(e) => listSet('steps', i, { text: e.target.value })} />
            </Field>
          </div>
        ))}
      </section>

      <section className="card">
        <h2>Preguntas frecuentes</h2>
        {s.faqs.map((x, i) => (
          <div key={i} className="form-grid">
            <Field label="Pregunta">
              <input value={x.q} onChange={(e) => listSet('faqs', i, { q: e.target.value })} />
            </Field>
            <Field label="Respuesta">
              <input value={x.a} onChange={(e) => listSet('faqs', i, { a: e.target.value })} />
            </Field>
            <button type="button" className="link-btn small danger" onClick={() => listDel('faqs', i)}>
              Quitar
            </button>
          </div>
        ))}
        <button type="button" className="btn small" onClick={() => set('faqs', [...s.faqs, { q: '', a: '' }])}>
          + Pregunta
        </button>
      </section>
    </div>
  );
}
