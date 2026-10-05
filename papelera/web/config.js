// Datos del negocio. Es lo único que hay que tocar para personalizar la web.
// (Más adelante lo va a editar el panel administrativo.)
window.CONFIG = {
  nombre: "Tu Papelera",
  bajada: "Limpieza, descartables y embalaje",
  // WhatsApp con código de país y sin + ni espacios, ej: "5491123456789".
  // Vacío: el pedido se abre en WhatsApp para elegir el contacto.
  whatsapp: "",
  instagram: "", // usuario sin @
  zona: "CABA y GBA",
  horario: "Lunes a viernes de 8 a 18 h · Sábados de 8 a 13 h",
  // El precio por mayor rige cuando el pedido (a precio por mayor) llega a este monto.
  minimoMayorista: 150000,
  // Desde este monto el envío no tiene cargo.
  envioSinCargoDesde: 80000,
  reparto: [
    { dias: "Lunes y jueves", zona: "CABA", barrios: "Centro, Palermo, Belgrano, Caballito, Flores, Almagro" },
    { dias: "Martes y viernes", zona: "GBA Norte y Oeste", barrios: "Vicente López, San Isidro, San Martín, Morón, Ramos Mejía" },
    { dias: "Miércoles y sábados", zona: "GBA Sur", barrios: "Avellaneda, Lanús, Lomas de Zamora, Quilmes, Banfield" },
  ],
  // Kits por rubro: [código, cantidad]. Los precios salen de la lista.
  kits: [
    {
      id: "gastro",
      rubro: "Gastronomía",
      para: "Rotiserías, pizzerías, bares y cocinas de delivery",
      items: [["PS0004", 8], ["PV0007", 3], ["PC0302", 1], ["PC0303", 1], ["LB0089", 5], ["LD0248", 2], ["LT0045", 4]],
    },
    {
      id: "consorcio",
      rubro: "Consorcios",
      para: "Administraciones, encargados y empresas de limpieza",
      items: [["LB0008", 4], ["LB0003", 6], ["LL0228", 3], ["LD0279", 2], ["LT0011", 6], ["LE0035", 1]],
    },
    {
      id: "oficina",
      rubro: "Oficinas y locales",
      para: "Oficinas, consultorios, gimnasios y peluquerías",
      items: [["LP0114", 4], ["LT0045", 6], ["LJ0087", 2], ["LL0252", 3], ["LP0181", 4], ["LD0297", 4], ["LB0070", 4]],
    },
  ],
};
