// Folleto de ventas en PDF, en español y en chino, con páginas del tamaño de un celular para
// mandarlo por WhatsApp.
// Uso: cd docs/folleto && npm install && node folleto.mjs [carpeta para la vista previa en PNG]
import { createRequire } from 'node:module';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const { chromium } = createRequire(join(here, '../../apps/web/package.json'))('@playwright/test');

const SITE = 'super-chino.onrender.com';
const W = 540;
const H = 1100;

/** Código de barras EAN-13 en SVG (misma lógica que apps/web/src/lib/ean13.ts). */
function ean13(code) {
  const L = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011'];
  const G = ['0100111', '0110011', '0011011', '0100001', '0011101', '0111001', '0000101', '0010001', '0001001', '0010111'];
  const R = ['1110010', '1100110', '1101100', '1000010', '1011100', '1001110', '1010000', '1000100', '1001000', '1110100'];
  const P = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL'];
  const left = [...code.slice(1, 7)].map((d, i) => (P[+code[0]][i] === 'L' ? L : G)[+d]).join('');
  const bits = '101' + left + '01010' + [...code.slice(7)].map((d) => R[+d]).join('') + '101';
  let d = '';
  for (let i = 0; i < bits.length; i++) if (bits[i] === '1') d += `M${i} 0h1v1h-1z`;
  return `<svg viewBox="0 0 ${bits.length} 1" preserveAspectRatio="none"><path d="${d}"/></svg>`;
}

// Maquetas de pantallas: mismos datos en los dos idiomas, solo cambian los textos.
const mock = {
  ticket: (m) => `<div class="mock">
    <div class="mhead"><b>🧾 ${m.register} · Sofía</b><span class="muted">18:42</span></div>
    ${[
      ['Yerba mate 1 kg', '', '$ 4.200'],
      ['Puré de tomate 520 g', '', '$ 1.200'],
      ['Yogur frutilla 190 g', '× 2', '$ 1.900'],
    ]
      .map(([n, q, p]) => `<div class="tl"><span>${n} <em>${q}</em></span><span>${p}</span></div>`)
      .join('')}
    <div class="tt"><span>${m.total}</span><span>$ 7.300</span></div>
    <div class="chips">${m.methods.map((x) => `<span>${x}</span>`).join('')}</div>
  </div>`,
  lots: (m) => `<div class="mock">
    <div class="mhead"><b>Yogur frutilla 190 g</b><span>${m.stock} 36</span></div>
    <div class="lot warn"><span>${m.lot} A · 12 ${m.u}</span><span>⚠️ ${m.soon}</span></div>
    <div class="lot"><span>${m.lot} B · 24 ${m.u}</span><span>${m.later}</span></div>
    <div class="chips"><span>📷 ${m.invoice}</span><span>📄 ${m.excel}</span></div>
  </div>`,
  offer: (m) => `<div class="mock">
    <div class="mhead"><b>Yogur frutilla 190 g</b><span class="tag">−35%</span></div>
    <div class="muted">${m.why}</div>
    <div class="prices"><s>$ 950</s><strong>$ 620</strong></div>
    <div class="chips"><span class="btn pri">${m.approve}</span><span class="btn">${m.dismiss}</span></div>
  </div>
  <div class="tiers">${m.tiers.map(([a, b], i) => `<div class="t${i}"><small>${a}</small>${b}</div>`).join('')}</div>`,
  chat: (m) => `<div class="mock chat">
    <div class="msg me"><div class="who">${m.owner}</div>今天把快过期的酸奶摆到前面，拍照给我。
      <div class="tr">🌐 Hoy poné adelante los yogures que están por vencer y mandame una foto.</div>
      <div class="meta">${m.read}</div></div>
    <div class="msg them"><div class="who">Sofía</div>¡Listo! Ya están adelante. 📷
      <div class="tr">🌐 好了！已经摆到前面了。📷</div>
      <div class="meta ok">${m.done}</div></div>
  </div>`,
  alerts: (items) => `<div class="mock">${items.map(([cls, ic, txt]) => `<div class="al ${cls}"><span>${ic}</span><span>${txt}</span></div>`).join('')}</div>`,
  label: (m) => `<div class="mock center">
    <div class="shelf">
      <div class="n">Puré de tomate 520 g</div>
      <div class="p">$ 1.200</div>
      <div class="u">$ 2.307,69 x kg</div>
      <div class="f">${ean13('7790000000010')}<span>7790000000010</span></div>
    </div>
    <div class="chips"><span>📈 ${m.bulk}</span></div>
    <div class="muted small">${m.note}</div>
  </div>`,
  staff: (m) => `<div class="mock">
    <div class="mhead"><b>🕘 ${m.today}</b><span class="muted">${m.title}</span></div>
    <div class="lot"><span><b>Sofía</b></span><span>${m.sofia}</span></div>
    <div class="lot warn"><span><b>Martín</b></span><span>${m.martin}</span></div>
    <div class="lot bad"><span><b>Lucas</b></span><span>${m.lucas}</span></div>
    <div class="order"><span>${m.month}</span><span class="btn xl">📥 Excel</span></div>
  </div>`,
  timeline: (items) =>
    `<div class="timeline">${items.map(([time, icon, text]) => `<div class="tl-row"><span class="tl-time">${time}</span><span class="tl-dot">${icon}</span><span class="tl-text">${text}</span></div>`).join('')}</div>`,
  dash: (m) => `<div class="mock">
    <div class="kpis">${m.kpis.map(([a, b]) => `<div><small>${a}</small><b>${b}</b></div>`).join('')}</div>
    <div class="bars">${m.bars.map(([a, p]) => `<div><span>${a}</span><span class="track"><i style="width:${p}%"></i></span><em>${p}%</em></div>`).join('')}</div>
    <div class="order"><span>🚚 <b>Distribuidora Norte</b> · ${m.order}</span><span class="btn wa">${m.wa}</span></div>
  </div>`,
};

const T = {
  es: {
    lang: 'es',
    file: 'Super-Chino-Español.pdf',
    cover: {
      kicker: 'Sistema para supermercados',
      lead: 'Caja, stock, vencimientos y tu equipo en una sola app. En español y en chino.',
      tiles: [
        ['🧾', 'Caja rápida'],
        ['📅', 'Vencimientos bajo control'],
        ['👥', 'Empleados y fichaje'],
        ['💬', 'Mensajes traducidos'],
        ['🛡️', 'Control anti-pérdidas'],
        ['📶', 'Anda sin internet'],
      ],
      foot: 'Funciona en PC, tablet y celular. Sin instalar nada.',
    },
    overview: {
      label: 'Resumen',
      title: 'Todo lo que hace',
      items: [
        ['🧾', 'Caja', 'Escaneás, cobrás y el stock se descuenta solo.'],
        ['📦', 'Stock por lote', 'Cada lote con su fecha de vencimiento.'],
        ['🏷️', 'Ofertas', 'Lo que está por vencer se vende en vez de tirarse.'],
        ['👥', 'Empleados', 'Fichaje, horas para el sueldo y aviso si llegan tarde.'],
        ['💬', 'Mensajes', 'Vos escribís en chino, tu equipo lee en español.'],
        ['🛡️', 'Anti-pérdidas', 'Avisos de anulaciones, faltantes de caja y conteos sorpresa.'],
        ['💲', 'Precios', 'Aumentos masivos y etiquetas con precio por kilo.'],
        ['💸', 'Pagos de caja', 'Pagos a proveedores y retiros anotados: el cierre da justo.'],
        ['📊', 'Reportes', 'Ventas y ganancia del día en tu celular.'],
        ['🚚', 'Reposición', 'Qué pedirle a cada proveedor, por WhatsApp.'],
      ],
      band: '📶 Sin internet, la caja sigue vendiendo.',
    },
    pages: [
      {
        label: 'Caja',
        icon: '🧾',
        title: 'Caja rápida',
        sub: 'Escaneás, cobrás y el stock se descuenta solo.',
        mock: mock.ticket({ register: 'Caja 1', total: 'TOTAL', methods: ['💵 Efectivo', '💳 Débito', '📱 QR', '🏦 Transferencia'] }),
        points: [
          '<b>Con el lector USB que ya tenés</b> o con la cámara del celular.',
          '<b>Descuenta primero el lote que vence antes:</b> el stock y los vencimientos siempre dan bien.',
          '<b>Efectivo, débito, crédito, QR o transferencia</b>, y pagos combinados. Calcula el vuelto.',
          '<b>Productos por peso</b> (fiambre, verdura): ponés los kilos y listo.',
          '<b>Sin internet sigue vendiendo</b> y sube todo cuando vuelve la conexión.',
          '<b>Cada cajero con su PIN.</b> Los pagos a proveedores y retiros de la caja quedan anotados, y el cierre da justo.',
        ],
      },
      {
        label: 'Empleados',
        icon: '👥',
        title: 'Tus empleados, bajo control',
        sub: 'Quién vino, a qué hora y cuántas horas trabajó. Sin planillas.',
        mock: mock.staff({
          today: 'Hoy',
          title: 'Horarios',
          sofia: 'entró 07:58 ✓',
          martin: '⚠️ 13:17 · 17 min tarde',
          lucas: '⛔ no vino (entraba 09:00)',
          month: 'Horas del mes: Sofía 162 h · Martín 148 h',
        }),
        points: [
          '<b>Fichan entrada y salida</b> en la caja con su PIN (aunque no haya internet) o desde el celular.',
          '<b>Te avisa si alguien llega tarde o no viene</b>, según su horario.',
          '<b>Horas trabajadas</b> por día, semana y mes, con tardanzas y faltas. Se bajan a Excel para los sueldos.',
          '<b>Ficha de cada uno:</b> DNI, teléfono, ingreso y sueldo. Solo la ves vos.',
          '<b>Usuario, PIN y permisos</b> para cada uno, y sabés quién vendió qué. Al que se va, lo desactivás.',
        ],
      },
      {
        label: 'Stock',
        icon: '📦',
        title: 'Stock y vencimientos',
        sub: 'Cada lote con su fecha. La app te avisa antes de que venza.',
        mock: mock.lots({
          stock: 'Stock',
          lot: 'Lote',
          u: 'u',
          soon: 'vence en 2 días',
          later: 'vence en 21 días',
          invoice: 'Factura leída: 18 productos',
          excel: 'Excel: 1240 productos',
        }),
        points: [
          '<b>Carga rápida:</b> escaneás el código y ponés nombre, cantidad y vencimiento. La caja ya lo reconoce.',
          '<b>Foto de la factura:</b> la inteligencia artificial lee productos, cantidades y costos. Vos revisás y guardás.',
          '<b>Foto del envase:</b> lee la fecha de vencimiento.',
          '<b>Importar desde Excel:</b> subís tu lista de productos y queda cargada en minutos.',
          '<b>Avisos de vencimiento</b> y tarea para retirar lo vencido, que queda anotado como pérdida.',
          '<b>Aviso de stock bajo</b> y, si sube el costo, <b>te sugiere el precio nuevo</b> con tu margen.',
        ],
      },
      {
        label: 'Ofertas',
        icon: '🏷️',
        title: 'Ofertas antes de que venza',
        sub: 'Vendé con descuento lo que ibas a tirar.',
        mock: mock.offer({
          why: 'Vence en 3 días · quedan 12 · se venden ~2 por día',
          approve: 'Aprobar',
          dismiss: 'Ignorar',
          tiers: [
            ['7 días antes', '−20%'],
            ['3 días antes', '−35%'],
            ['Último día', '−50%'],
          ],
        }),
        points: [
          'La app <b>detecta los lotes que no vas a llegar a vender</b> a tiempo, según lo que vendés por día.',
          '<b>Sugiere el descuento</b> según los días que faltan (lo configurás a tu gusto) y no vende por debajo del costo salvo el último día.',
          '<b>Lo aprobás con un toque</b> (o que se apruebe solo) y la caja cobra el precio de oferta.',
          '<b>Imprimís el cartel</b> o lo <b>compartís por WhatsApp</b>.',
          'Ves <b>cuánta plata recuperaste</b> en el mes y cuánto se perdió.',
        ],
      },
      {
        label: 'Tareas',
        icon: '💬',
        title: 'Indicaciones en tu idioma',
        sub: 'Vos escribís en chino y tus empleados leen en español. Y al revés.',
        mock: mock.chat({ owner: 'Dueño', read: '✓✓ Leído por Sofía y Martín', done: '✓ Tarea hecha, con foto' }),
        points: [
          '<b>Mandás indicaciones o tareas</b> a uno o a todos, con fecha límite y fotos.',
          '<b>Se traducen solas</b> chino ↔ español, con inteligencia artificial.',
          '<b>Ves quién leyó y quién cumplió.</b> Podés pedir una foto como prueba.',
          '<b>Tareas automáticas:</b> retirar lo vencido y el conteo sorpresa.',
          '<b>Avisos en tu celular</b>, aunque no estés en el local.',
        ],
      },
      {
        label: 'Control',
        icon: '🛡️',
        title: 'Control anti-pérdidas',
        sub: 'Te enterás de lo raro sin estar en la caja.',
        mock: mock.alerts([
          ['red', '⚠️', '<b>Martín</b> borró o anuló 7 veces en su turno'],
          ['', '💵', '<b>Cierre de Sofía:</b> diferencia −$ 1.200'],
          ['', '🔎', '<b>Conteo:</b> Aceite girasol 1,5 L — sistema 12, contado 9'],
          ['green', '📊', '<b>Resumen 21 hs:</b> ventas $ 845.300 · 312 tickets'],
        ]),
        points: [
          '<b>Productos borrados del ticket y ventas anuladas:</b> si un cajero se pasa del límite en su turno, te avisa.',
          '<b>Cierre de caja:</b> si falta o sobra plata, te avisa (desde $ 500, lo configurás).',
          '<b>Conteo sorpresa todos los días:</b> la app elige productos (más seguido los caros y los que más se venden) y el empleado los cuenta <b>sin ver cuánto debería haber</b>.',
          '<b>Ventas sin stock cargado:</b> te avisa para que revises.',
          '<b>Resumen del día en tu celular</b> a las 21 hs.',
        ],
      },
      {
        label: 'Precios',
        icon: '💲',
        title: 'Precios y etiquetas',
        sub: 'Con la inflación, cambiar precios tiene que ser fácil.',
        mock: mock.label({ bulk: 'Almacén <b>+8%</b>: 214 precios actualizados', note: 'Etiqueta de góndola con precio por kilo, lista para imprimir.' }),
        points: [
          '<b>Aumento masivo</b> por categoría o por proveedor (por ejemplo +8%), con redondeo automático.',
          '<b>Precio según tu margen:</b> si sube el costo, te calcula el precio nuevo.',
          '<b>Historial:</b> quién cambió cada precio y cuándo.',
          '<b>Etiquetas de góndola</b> con precio, <b>precio por kilo o por litro</b> (lo que pide la ley) y código de barras, en hoja A4.',
          '<b>Imprimís solo las que cambiaron</b> desde el día que elijas.',
        ],
      },
      {
        label: 'Reportes',
        icon: '📊',
        title: 'Tu negocio en el celular',
        sub: 'Todo lo que pasa en el local, aunque no estés.',
        mock: mock.dash({
          kpis: [
            ['Ventas hoy', '$ 845.300'],
            ['Tickets', '312'],
            ['Ganancia', '$ 236.700'],
          ],
          bars: [
            ['Efectivo', 52],
            ['Débito', 31],
            ['QR', 17],
          ],
          order: '6 productos para pedir',
          wa: 'Pedir por WhatsApp',
        }),
        points: [
          '<b>Ventas del día</b>, tickets, ticket promedio y <b>ganancia</b>.',
          'Ventas <b>por medio de pago</b> y <b>por cajero</b>, y lo más vendido.',
          '<b>Qué reponer:</b> calcula cuánto pedir según lo que vendés, el stock mínimo y los días de entrega de cada proveedor.',
          '<b>Le mandás el pedido al proveedor por WhatsApp</b> con un toque.',
          '<b>Historial de ventas y de cierres de caja.</b>',
        ],
      },
      {
        label: 'Día a día',
        icon: '📅',
        title: 'Un día en tu súper',
        sub: 'Así es un día normal con Super Chino.',
        mock: mock.timeline([
          ['07:58', '🕗', '<b>Sofía ficha la entrada</b> en la caja y la abre con el cambio.'],
          ['09:30', '🚚', '<b>Llega el proveedor:</b> foto de la factura y la mercadería queda cargada con sus vencimientos.'],
          ['09:45', '💸', '<b>Le pagás con plata de la caja:</b> queda anotado como pago al proveedor.'],
          ['10:00', '💬', '<b>Le mandás una tarea en chino.</b> Sofía la lee en español y la cumple con foto.'],
          ['13:17', '⚠️', '<b>Martín llega 17 minutos tarde:</b> te llega el aviso al celular.'],
          ['15:00', '🔎', '<b>Conteo sorpresa:</b> 5 productos contados sin ver cuánto dice el sistema.'],
          ['17:00', '🏷️', '<b>Ofertas</b> de lo que vence mañana, con el cartel impreso.'],
          ['20:30', '🧾', '<b>Cierre de caja:</b> ya descontó el pago al proveedor y da justo.'],
          ['21:00', '📊', '<b>Resumen del día en tu celular:</b> ventas, ganancia y avisos.'],
        ]),
        points: [],
      },
    ],
    last: {
      label: 'Empezar',
      title: 'Probalo ahora',
      demoKicker: 'Demo gratis',
      demoText: 'Tocá <b>«Entrar como dueño»</b> o <b>«Entrar como empleada»</b>. Es un súper de ejemplo con productos, ventas y ofertas.',
      demoNote: 'La primera vez puede tardar un minuto en abrir. Si la ves en chino, cambiá el idioma con el botón de arriba.',
      faqTitle: 'Preguntas frecuentes',
      faq: [
        ['¿Hay que instalar algo?', 'No. Se abre en el navegador y se puede instalar como app en PC, tablet o celular (Android y iPhone).'],
        ['¿Sirve mi lector de códigos?', 'Sí, cualquier lector USB.'],
        ['¿Y si se corta internet?', 'La caja sigue vendiendo y sincroniza cuando vuelve.'],
        ['¿En qué idiomas está?', 'Español y chino. Cada usuario elige el suyo.'],
        ['¿Hace factura electrónica?', 'Por ahora da un ticket no fiscal. Si la necesitás, se agrega.'],
      ],
      band: '💬 Precios y planes: escribime por este WhatsApp.',
    },
  },
  zh: {
    lang: 'zh-Hans',
    file: 'Super-Chino-中文.pdf',
    cover: {
      kicker: '超市管理系统',
      lead: '收银、库存、保质期和员工管理，一个 App 全搞定。中文、西班牙语都能用。',
      tiles: [
        ['🧾', '快速收银'],
        ['📅', '保质期全掌握'],
        ['👥', '员工考勤'],
        ['💬', '消息自动翻译'],
        ['🛡️', '防损防漏'],
        ['📶', '断网也能用'],
      ],
      foot: '电脑、平板、手机都能用，不用安装。',
    },
    overview: {
      label: '功能',
      title: '功能一览',
      items: [
        ['🧾', '收银', '扫码收款，库存自动扣减。'],
        ['📦', '批次库存', '每一批货都有自己的到期日。'],
        ['🏷️', '临期促销', '快过期的打折卖掉，不用扔。'],
        ['👥', '员工考勤', '打卡、算工时发工资，迟到会提醒。'],
        ['💬', '员工消息', '你写中文，员工看到西班牙语。'],
        ['🛡️', '防损', '删单作废、收银差额、抽查盘点都会提醒。'],
        ['💲', '改价', '批量调价，价签自动标每公斤价格。'],
        ['💸', '钱箱支出', '付供应商、老板取钱都记账，交班分毫不差。'],
        ['📊', '报表', '今天卖了多少、赚了多少，手机上就能看。'],
        ['🚚', '补货', '该向哪个供应商订什么，用 WhatsApp 发订单。'],
      ],
      band: '📶 断网也能继续收银。',
    },
    pages: [
      {
        label: '收银',
        icon: '🧾',
        title: '快速收银',
        sub: '扫码、收款，库存自动扣减。',
        mock: mock.ticket({ register: '收银台 1', total: '合计', methods: ['💵 现金', '💳 借记卡', '📱 二维码', '🏦 转账'] }),
        points: [
          '<b>你现在用的 USB 扫码枪就能用</b>，也可以用手机摄像头扫码。',
          '<b>先扣最早到期的批次</b>，库存和保质期始终准确。',
          '<b>现金、借记卡、信用卡、二维码、转账</b>都能收，可以混合付款，自动算找零。',
          '<b>称重商品</b>（熟食、蔬菜水果）：输入公斤数就行。',
          '<b>断网照样收银</b>，网络恢复后自动上传。',
          '<b>每个收银员用自己的 PIN 登录。</b>用钱箱里的钱付供应商、老板取钱都会记下来，交班分毫不差。',
        ],
      },
      {
        label: '员工',
        icon: '👥',
        title: '员工管理',
        sub: '谁来了、几点来的、干了几个小时，一目了然。',
        mock: mock.staff({
          today: '今天',
          title: '考勤',
          sofia: '07:58 上班 ✓',
          martin: '⚠️ 13:17 · 迟到 17 分钟',
          lucas: '⛔ 没来（应 09:00 上班）',
          month: '本月工时：Sofía 162 小时 · Martín 148 小时',
        }),
        points: [
          '<b>上下班打卡：</b>在收银台用 PIN 打卡（断网也行），或者用自己的手机打卡。',
          '<b>迟到、没来都会提醒你</b>，按你给每个人设的排班。',
          '<b>工时统计：</b>按天、周、月算工作小时，还有迟到和缺勤，可以导出 Excel 算工资。',
          '<b>员工档案：</b>证件号、电话、入职日期和工资，只有你能看到。',
          '<b>每人一个账号和 PIN</b>，权限你来定：收银、入库、改价或查看销售。人走了一键停用。',
          '<b>谁卖了什么</b>，每个收银员的交班对账都清清楚楚。',
        ],
      },
      {
        label: '库存',
        icon: '📦',
        title: '库存和保质期',
        sub: '每一批货都有到期日，快过期会提前提醒你。',
        mock: mock.lots({
          stock: '库存',
          lot: '批次',
          u: '个',
          soon: '2 天后到期',
          later: '21 天后到期',
          invoice: '发票识别：18 个商品',
          excel: 'Excel 导入：1240 个商品',
        }),
        points: [
          '<b>快速入库：</b>扫条码，填名称、数量和到期日，收银台马上就能扫到。',
          '<b>拍照识别发票：</b>给供应商的发票拍张照，AI 自动识别商品、数量和成本，你核对后保存。',
          '<b>拍照识别到期日：</b>拍一下包装就能读出日期。',
          '<b>Excel 导入：</b>把现有的商品表上传，几分钟全部录好。',
          '<b>临期提醒</b>；过期了自动派<b>下架任务</b>，下架后记为损耗。',
          '<b>库存不足提醒</b>；进价涨了，<b>按你的利润率建议新售价</b>。',
        ],
      },
      {
        label: '促销',
        icon: '🏷️',
        title: '临期促销',
        sub: '快过期的商品打折卖掉，不用扔。',
        mock: mock.offer({
          why: '3 天后到期 · 剩 12 个 · 每天约卖 2 个',
          approve: '批准',
          dismiss: '忽略',
          tiers: [
            ['剩 7 天', '−20%'],
            ['剩 3 天', '−35%'],
            ['最后 1 天', '−50%'],
          ],
        }),
        points: [
          '系统根据每天的销量，<b>找出到期前卖不完的批次</b>。',
          '<b>自动建议折扣</b>：剩的天数越少，折扣越大（可以自己设）；最后一天之前不会低于成本价。',
          '<b>一键批准</b>（也可以设成自动批准），收银台自动按促销价收款。',
          '<b>打印促销海报</b>，或者<b>分享到 WhatsApp</b>。',
          '每个月都能看到<b>挽回了多少钱</b>、损耗了多少。',
        ],
      },
      {
        label: '任务',
        icon: '💬',
        title: '语言不通也不怕',
        sub: '你写中文，员工看到西班牙语；员工回西语，你看到中文。',
        mock: mock.chat({ owner: '老板', read: '✓✓ Sofía、Martín 已读', done: '✓ 任务已完成（附照片）' }),
        points: [
          '<b>给一个人或全体员工发指示和任务</b>，可以设截止时间、附照片。',
          '<b>中文和西班牙语自动互译</b>（AI），随时能看原文。',
          '<b>谁看了、谁做了，一目了然。</b>任务可以要求拍照为证。',
          '<b>自动派任务：</b>下架过期商品、每天抽查盘点，系统自动发给员工。',
          '<b>手机收到通知</b>，人不在店里也知道。',
        ],
      },
      {
        label: '防损',
        icon: '🛡️',
        title: '防损防漏',
        sub: '人不在收银台，也知道哪里不对劲。',
        mock: mock.alerts([
          ['red', '⚠️', '<b>Martín</b> 本班删除商品或作废 7 次'],
          ['', '💵', '<b>Sofía 交班：</b>差额 −$ 1.200'],
          ['', '🔎', '<b>抽查盘点：</b>Aceite girasol 1,5 L — 系统 12，实点 9'],
          ['green', '📊', '<b>21:00 今日汇总：</b>销售额 $ 845.300 · 312 单'],
        ]),
        points: [
          '<b>收银删除商品、作废小票：</b>某个收银员一个班次超过设定次数，马上提醒你。',
          '<b>交班对账：</b>现金多了或少了（默认超过 $ 500，可以自己设）就提醒你。',
          '<b>每天抽查盘点：</b>系统挑几样商品（贵的、卖得多的更常被抽到），员工清点时<b>看不到系统数量</b>，对不上就提醒你。',
          '<b>没有入库记录却卖出：</b>提醒你检查入库。',
          '<b>每晚 9 点</b>把当天汇总发到你手机上。',
        ],
      },
      {
        label: '改价',
        icon: '💲',
        title: '改价和价签',
        sub: '通货膨胀涨价快，改价一定要简单。',
        mock: mock.label({ bulk: 'Almacén 分类 <b>+8%</b>：214 个商品已改价', note: '价签用西班牙语打印，给顾客看。' }),
        points: [
          '<b>批量改价：</b>按分类或供应商一起调（比如 +8%），自动取整。',
          '<b>按利润率定价：</b>进价涨了，系统帮你算新售价。',
          '<b>价格记录：</b>谁、什么时候改了什么价。',
          '<b>货架价签：</b>价格、<b>每公斤或每升价格</b>（法律要求）和条形码，A4 纸直接打印。',
          '<b>只打印改过价的价签</b>，从哪天开始由你选。',
        ],
      },
      {
        label: '报表',
        icon: '📊',
        title: '生意情况，手机随时看',
        sub: '人不在店里，店里的事也清清楚楚。',
        mock: mock.dash({
          kpis: [
            ['今日销售额', '$ 845.300'],
            ['单数', '312'],
            ['利润', '$ 236.700'],
          ],
          bars: [
            ['现金', 52],
            ['借记卡', 31],
            ['二维码', 17],
          ],
          order: '6 个商品需要补货',
          wa: '用 WhatsApp 下单',
        }),
        points: [
          '<b>今日销售额</b>、单数、客单价和<b>利润</b>。',
          '<b>按付款方式</b>、<b>按收银员</b>统计，还有今日热销。',
          '<b>补货建议：</b>根据每天销量、最低库存和供应商送货天数，算出该订多少。',
          '<b>一键用 WhatsApp 给供应商发订单。</b>',
          '<b>销售记录和交班记录。</b>',
        ],
      },
      {
        label: '日常',
        icon: '📅',
        title: '超市的一天',
        sub: '用 Super Chino，普通的一天是这样的。',
        mock: mock.timeline([
          ['07:58', '🕗', '<b>Sofía 在收银台打卡上班</b>，放好备用金开班。'],
          ['09:30', '🚚', '<b>供应商送货：</b>给发票拍张照，商品和到期日自动入库。'],
          ['09:45', '💸', '<b>用钱箱里的钱付货款：</b>系统记为付供应商。'],
          ['10:00', '💬', '<b>你用中文发任务</b>，Sofía 看到的是西班牙语，做完拍照回复。'],
          ['13:17', '⚠️', '<b>Martín 迟到 17 分钟：</b>你的手机马上收到提醒。'],
          ['15:00', '🔎', '<b>抽查盘点：</b>员工清点 5 样商品，看不到系统数量。'],
          ['17:00', '🏷️', '<b>明天到期的商品打折</b>，打印促销海报。'],
          ['20:30', '🧾', '<b>交班对账：</b>已经扣掉付给供应商的钱，分毫不差。'],
          ['21:00', '📊', '<b>今日汇总发到你手机：</b>销售额、利润和提醒。'],
        ]),
        points: [],
      },
    ],
    last: {
      label: '开始',
      title: '现在就试试',
      demoKicker: '免费演示',
      demoText: '点<b>「以老板身份进入」</b>或<b>「以员工身份进入」</b>。里面是一个有商品、销售和促销的示例超市。',
      demoNote: '第一次打开可能要等一分钟左右。界面语言可以在上方切换。',
      faqTitle: '常见问题',
      faq: [
        ['需要安装吗？', '不需要。用浏览器就能打开，也可以像 App 一样装在电脑、平板或手机上（安卓、苹果都行）。'],
        ['我现在的扫码枪能用吗？', '能，任何 USB 扫码枪都可以。'],
        ['断网怎么办？', '照常收银，网络恢复后自动同步。'],
        ['支持哪些语言？', '中文和西班牙语，每个人选自己的语言。'],
        ['能开电子发票吗？', '目前打印的是普通小票（不作为发票）。需要的话可以加上。'],
      ],
      band: '💬 价格和方案：直接在 WhatsApp 问我。',
    },
  },
};

const CSS = `
@page { size: ${W}px ${H}px; margin: 0; }
:root { --red: #c8102e; --gold: #f2b705; --ink: #1f1a17; --muted: #6b625c; --cream: #fff6ea; --line: #eadfd2; --green: #1e9e57; }
* { box-sizing: border-box; }
html, body { margin: 0; }
body { font-family: 'Inter Variable', 'Noto Sans SC Variable', 'Noto Color Emoji', sans-serif; color: var(--ink); background: #fff;
  -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.page { width: ${W}px; height: ${H}px; padding: 36px 40px 30px; display: flex; flex-direction: column; gap: 18px; overflow: hidden;
  position: relative; background: #fff; break-after: page; }
.top { display: flex; justify-content: space-between; font-size: 13px; font-weight: 800; letter-spacing: .1em; text-transform: uppercase; color: var(--red); }
.top span:last-child { color: var(--muted); }
.foot { margin-top: auto; display: flex; justify-content: space-between; font-size: 13px; color: var(--muted); border-top: 1px solid var(--line); padding-top: 12px; }
.ic { width: 64px; height: 64px; border-radius: 18px; background: #fde7ea; display: grid; place-items: center; font-size: 34px; margin-top: 4px; }
h1 { margin: 0; font-size: 40px; line-height: 1.12; font-weight: 800; letter-spacing: -.02em; }
:lang(zh) h1 { letter-spacing: 0; line-height: 1.25; }
h2 { margin: 2px 0 -6px; font-size: 24px; font-weight: 800; }
.sub { margin: -8px 0 0; font-size: 21px; line-height: 1.45; color: var(--muted); }
b, strong { font-weight: 700; }
.muted { color: var(--muted); }
.small { font-size: 14px; }
.pts { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 12px; }
.pts li { position: relative; padding-left: 24px; font-size: 20px; line-height: 1.45; }
:lang(zh) .pts li { line-height: 1.65; }
.pts li::before { content: ''; position: absolute; left: 3px; top: .62em; width: 9px; height: 9px; border-radius: 50%; background: var(--red); }

/* Tapa */
.cover { background: linear-gradient(165deg, #d8152f, #9e0c24); color: #fff; padding: 64px 44px 40px; gap: 0; }
.cover::before, .cover::after { content: ''; position: absolute; border-radius: 50%; border: 56px solid rgba(242, 183, 5, .16); }
.cover::before { width: 440px; height: 440px; right: -190px; top: -170px; }
.cover::after { width: 300px; height: 300px; left: -170px; bottom: 120px; }
.cover > * { position: relative; z-index: 1; }
.kicker { font-size: 17px; font-weight: 700; letter-spacing: .14em; text-transform: uppercase; color: var(--gold); }
.brand { font-size: 124px; font-weight: 900; line-height: .92; letter-spacing: -.04em; margin-top: 18px; }
.brand span { color: var(--gold); }
.lead { font-size: 27px; line-height: 1.42; margin: 34px 0 0; color: #ffe9ec; font-weight: 500; }
.tiles { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-top: auto; }
.tile { background: rgba(255, 255, 255, .12); border: 1px solid rgba(255, 255, 255, .25); border-radius: 18px; padding: 18px 20px; font-size: 20px; font-weight: 700; line-height: 1.3; }
.tile i { display: block; font-style: normal; font-size: 34px; margin-bottom: 8px; }
.cfoot { margin-top: 30px; font-size: 17px; line-height: 1.5; color: #ffdfe3; border-top: 1px solid rgba(255, 255, 255, .25); padding-top: 16px; }
.cfoot b { color: #fff; font-size: 20px; }

/* Resumen */
.grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.card { background: var(--cream); border: 1px solid var(--line); border-radius: 16px; padding: 12px 14px 14px; }
.card i { font-style: normal; font-size: 26px; }
.card b { display: block; font-size: 19px; margin: 4px 0 2px; }
.card span { font-size: 16px; line-height: 1.42; color: #4a423c; }
.band { background: var(--green); color: #fff; border-radius: 16px; padding: 16px 20px; font-size: 20px; font-weight: 700; line-height: 1.4; }
.band.red { background: var(--red); }

/* Maquetas */
.mock { background: var(--cream); border: 1px solid var(--line); border-radius: 18px; padding: 16px 18px; display: flex; flex-direction: column; gap: 9px; font-size: 17px; }
.mock.center { align-items: center; text-align: center; }
.mhead { display: flex; justify-content: space-between; align-items: center; gap: 10px; font-size: 18px; }
.tl { display: flex; justify-content: space-between; border-bottom: 1px dashed #dccfbf; padding-bottom: 7px; }
.tl em { font-style: normal; color: var(--muted); }
.tt { display: flex; justify-content: space-between; font-size: 22px; font-weight: 800; }
.chips { display: flex; flex-wrap: wrap; gap: 7px; justify-content: inherit; }
.chips span { background: #fff; border: 1px solid var(--line); border-radius: 999px; padding: 5px 12px; font-size: 15.5px; }
.lot { display: flex; justify-content: space-between; background: #fff; border: 1px solid var(--line); border-radius: 11px; padding: 9px 13px; }
.lot.warn { background: #fff4d6; border-color: #f3cf74; font-weight: 600; }
.lot.bad { background: #fde7ea; border-color: #f1a9b4; color: #9e0c24; font-weight: 600; }
.btn.xl { background: #1e7b45; color: #fff; border-radius: 999px; padding: 6px 12px; font-weight: 700; white-space: nowrap; }
.timeline { display: flex; flex-direction: column; }
.tl-row { display: grid; grid-template-columns: 62px 40px 1fr; align-items: start; gap: 8px; padding: 9px 0; border-bottom: 1px dashed var(--line); }
.tl-time { font-weight: 800; color: var(--red); font-size: 18px; padding-top: 6px; font-variant-numeric: tabular-nums; }
.tl-dot { width: 38px; height: 38px; border-radius: 50%; background: #fde7ea; display: grid; place-items: center; font-size: 19px; }
.tl-text { font-size: 18.5px; line-height: 1.42; }
:lang(zh) .tl-text { line-height: 1.6; }
.tag { background: var(--gold); color: #3a2a00; border-radius: 999px; padding: 3px 11px; font-weight: 800; font-size: 16px; }
.prices { font-size: 34px; font-weight: 800; color: var(--red); }
.prices s { font-size: 21px; font-weight: 500; color: var(--muted); margin-right: 12px; }
.chips .btn { font-weight: 700; padding: 7px 16px; }
.chips .btn.pri, .btn.pri { background: var(--red); border-color: var(--red); color: #fff; }
.tiers { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-top: -6px; }
.tiers div { border-radius: 14px; padding: 10px 6px; color: #fff; font-weight: 800; font-size: 24px; text-align: center; }
.tiers small { display: block; font-size: 13.5px; font-weight: 600; }
.tiers .t0 { background: #f59e0b; } .tiers .t1 { background: #ea580c; } .tiers .t2 { background: var(--red); }
.chat { gap: 12px; }
.msg { max-width: 90%; border-radius: 16px; padding: 10px 14px; line-height: 1.42; font-size: 17px; }
.msg.me { align-self: flex-end; background: #fde7ea; border-bottom-right-radius: 4px; }
.msg.them { align-self: flex-start; background: #fff; border: 1px solid var(--line); border-bottom-left-radius: 4px; }
.who { font-size: 13px; font-weight: 800; color: var(--red); margin-bottom: 3px; }
.tr { margin-top: 7px; padding-top: 7px; border-top: 1px dashed rgba(0, 0, 0, .18); color: #3d3530; }
.meta { font-size: 12.5px; color: var(--muted); margin-top: 6px; text-align: right; }
.meta.ok { color: var(--green); font-weight: 700; }
.al { display: flex; gap: 10px; background: #fff; border: 1px solid var(--line); border-left: 5px solid var(--gold); border-radius: 10px; padding: 9px 12px; line-height: 1.38; }
.al.red { border-left-color: var(--red); } .al.green { border-left-color: var(--green); }
.shelf { background: #fff; border: 2px solid #222; border-radius: 6px; padding: 12px 16px 10px; width: 300px; text-align: left; }
.shelf .n { font-size: 17px; font-weight: 700; }
.shelf .p { font-size: 50px; font-weight: 900; line-height: 1.05; letter-spacing: -.02em; }
.shelf .u { font-size: 15px; }
.shelf .f { display: flex; align-items: center; gap: 10px; font-size: 11px; margin-top: 8px; }
.shelf svg { width: 130px; height: 30px; }
.kpis { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
.kpis div { background: #fff; border: 1px solid var(--line); border-radius: 12px; padding: 8px 10px; }
.kpis small { display: block; font-size: 12.5px; color: var(--muted); }
.kpis b { font-size: 19px; }
.bars { display: flex; flex-direction: column; gap: 6px; }
.bars div { display: grid; grid-template-columns: 76px 1fr 40px; align-items: center; gap: 8px; font-size: 14.5px; }
.bars em { font-style: normal; text-align: right; color: var(--muted); }
.track { height: 11px; background: #efe4d6; border-radius: 6px; overflow: hidden; }
.track i { display: block; height: 100%; background: var(--red); border-radius: 6px; }
.order { display: flex; justify-content: space-between; align-items: center; gap: 8px; background: #fff; border: 1px solid var(--line); border-radius: 12px; padding: 9px 12px; font-size: 14.5px; }
.btn.wa { background: #25d366; color: #fff; border-radius: 999px; padding: 6px 12px; font-weight: 700; white-space: nowrap; }

/* Última página */
.demo { display: block; text-decoration: none; background: var(--red); color: #fff; border-radius: 20px; padding: 22px 24px 20px; }
.demo .k { font-size: 14px; font-weight: 800; letter-spacing: .12em; text-transform: uppercase; color: var(--gold); }
.demo .url { font-size: 29px; font-weight: 800; margin: 6px 0 10px; text-decoration: underline; text-decoration-thickness: 2px; text-underline-offset: 5px; }
.demo p { margin: 0; font-size: 19px; line-height: 1.45; }
.demo small { display: block; margin-top: 10px; font-size: 14.5px; line-height: 1.45; color: #ffdfe3; }
.faq { display: flex; flex-direction: column; gap: 13px; }
.faq b { display: block; font-size: 19px; margin-bottom: 2px; }
.faq span { font-size: 18px; line-height: 1.45; color: #3d3530; }
`;

function render(c) {
  const total = c.pages.length + 3;
  const shell = (n, label, body) => `<section class="page">
    <div class="top"><span>Super Chino</span><span>${label}</span></div>
    ${body}
    <div class="foot"><span>${SITE}</span><span>${n} / ${total}</span></div>
  </section>`;
  const cover = `<section class="page cover">
    <div class="kicker">${c.cover.kicker}</div>
    <div class="brand">Super<br><span>Chino</span></div>
    <p class="lead">${c.cover.lead}</p>
    <div class="tiles">${c.cover.tiles.map(([i, s]) => `<div class="tile"><i>${i}</i>${s}</div>`).join('')}</div>
    <div class="cfoot">${c.cover.foot}<br><b>${SITE}</b></div>
  </section>`;
  const overview = shell(
    2,
    c.overview.label,
    `<h1>${c.overview.title}</h1>
    <div class="grid">${c.overview.items.map(([i, b, s]) => `<div class="card"><i>${i}</i><b>${b}</b><span>${s}</span></div>`).join('')}</div>
    <div class="band">${c.overview.band}</div>`,
  );
  const pages = c.pages.map((p, i) =>
    shell(
      i + 3,
      p.label,
      `<div class="ic">${p.icon}</div><h1>${p.title}</h1><p class="sub">${p.sub}</p>${p.mock}
      ${p.points.length ? `<ul class="pts">${p.points.map((x) => `<li>${x}</li>`).join('')}</ul>` : ''}`,
    ),
  );
  const last = shell(
    total,
    c.last.label,
    `<div class="ic">🚀</div><h1>${c.last.title}</h1>
    <a class="demo" href="https://${SITE}"><div class="k">${c.last.demoKicker}</div><div class="url">${SITE}</div>
      <p>${c.last.demoText}</p><small>${c.last.demoNote}</small></a>
    <h2>${c.last.faqTitle}</h2>
    <div class="faq">${c.last.faq.map(([q, a]) => `<div><b>${q}</b><span>${a}</span></div>`).join('')}</div>
    <div class="band red">${c.last.band}</div>`,
  );
  return `<!doctype html><html lang="${c.lang}"><head><meta charset="utf-8">
<link rel="stylesheet" href="/node_modules/@fontsource-variable/inter/index.css">
<link rel="stylesheet" href="/node_modules/@fontsource-variable/noto-sans-sc/index.css">
<style>${CSS}</style></head><body>${[cover, overview, ...pages, last].join('\n')}</body></html>`;
}

const previewDir = process.argv[2];
const browser = await chromium.launch(existsSync('/opt/pw-browsers/chromium') ? { executablePath: '/opt/pw-browsers/chromium' } : {});
for (const c of [T.es, T.zh]) {
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  // Se sirve todo desde esta carpeta (las fuentes están en node_modules), sin salir a internet.
  await page.route('http://folleto.local/**', (route) => {
    const { pathname } = new URL(route.request().url());
    if (pathname === '/') return route.fulfill({ body: render(c), contentType: 'text/html; charset=utf-8' });
    return route.fulfill({ path: join(here, decodeURIComponent(pathname)) });
  });
  await page.goto('http://folleto.local/', { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  const long = await page.$$eval('.page', (els) => els.flatMap((el, i) => (el.scrollHeight > el.clientHeight + 1 ? [i + 1] : [])));
  if (long.length) console.warn(`⚠ ${c.file}: se pasan de largo las páginas ${long.join(', ')}`);
  await page.pdf({ path: join(here, c.file), preferCSSPageSize: true, printBackground: true });
  if (previewDir) {
    mkdirSync(previewDir, { recursive: true });
    for (const [i, el] of (await page.$$('.page')).entries()) await el.screenshot({ path: join(previewDir, `${c.lang}-${i + 1}.png`) });
    await page.setViewportSize({ width: 1400, height: 1000 });
    await page.addStyleTag({ content: 'body{display:flex;flex-wrap:wrap;gap:12px;width:2800px;zoom:.5;background:#888}' });
    await page.screenshot({ path: join(previewDir, `${c.lang}.png`), fullPage: true });
  }
  console.log(`✓ ${c.file}`);
}
await browser.close();
