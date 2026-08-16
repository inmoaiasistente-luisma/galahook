/* =========================================================
   GALÁPAGOS HOOK ADVENTURE — content store
   Bilingual (en/es). Every field here is editable from /admin.
   Admin saves overrides to localStorage (key: GHA_CONTENT).
   ========================================================= */
window.GHA_DEFAULT = {
  meta: {
    brand: "Galápagos Hook Adventure",
    slogan: { en: "Local Roots · Wild Experiences", es: "Raíces Locales · Experiencias Salvajes" },
    whatsapp: "15513129717",
    instagram: "galapagoshookadventure",
    tiktok: "galapagoshookadve",
    email: "galahookadventure@outlook.com",
    phone: "+1 551-312-9717",
    address: { en: "Puerto Baquerizo Moreno · San Cristóbal, Galápagos, Ecuador", es: "Puerto Baquerizo Moreno · San Cristóbal, Galápagos, Ecuador" },
    addressUs: { en: "12515 Lake Square Cir, Orlando, Florida 32821 · United States", es: "12515 Lake Square Cir, Orlando, Florida 32821 · Estados Unidos" },
    phoneUs: "+1 (407) 000-0000",
    hours: { en: "Mon – Sun · 7:00 AM – 7:00 PM", es: "Lun – Dom · 7:00 AM – 7:00 PM" },
    /* ---- LEGADO — NO USAR ----------------------------------------------
       Los pagos y los correos los gestiona el SERVIDOR con variables de
       entorno (Stripe, Supabase y Resend). Estos tres campos quedaron sin
       uso y NO los lee ningún código.

       NUNCA pegues aquí una clave de Stripe ni un endpoint externo: este
       archivo se sirve al navegador y sería público.
       -------------------------------------------------------------------- */
    notifyEmail: "",      /* sin uso — el buzón interno es BOOKING_NOTIFICATION_EMAIL */
    stripeKey: "",        /* sin uso — la clave publicable la sirve /api/stripe-config */
    formEndpoint: "",     /* sin uso — los correos salen de Resend en el servidor */
    cancelDays: 30        /* free cancellation window (sí se usa en los textos) */
  },

  hero: {
    slides: ["assets/img/kicker-sunrise.jpg","assets/img/kicker-day.jpg","assets/img/sea-cave.jpg","assets/img/sealion-underwater.jpg"],
    kicker: { en: "San Cristóbal Island · Galápagos", es: "Isla San Cristóbal · Galápagos" },
    title: { en: "EXPERIENCE GALÁPAGOS", es: "VIVE GALÁPAGOS" },
    script: { en: "like a local", es: "como un local" },
    sub: {
      en: "All-inclusive island journeys, ocean tours and world-class sport fishing — run by a local San Cristóbal family who know these waters by heart.",
      es: "Viajes todo incluido, tours oceánicos y pesca deportiva de clase mundial — dirigidos por una familia local de San Cristóbal que conoce estas aguas de memoria."
    },
    cta1: { en: "Explore Packages", es: "Ver Paquetes" },
    cta2: { en: "Plan With Us", es: "Planifica con Nosotros" }
  },

  trust: [
    { en: "Local Operators", es: "Operadores Locales" },
    { en: "All-Inclusive Journeys", es: "Viajes Todo Incluido" },
    { en: "Responsible Tourism", es: "Turismo Responsable" },
    { en: "Private Boats", es: "Botes Privados" },
    { en: "San Cristóbal Based", es: "Con Base en San Cristóbal" }
  ],

  /* ---------------- PACKAGES (lead experience) ---------------- */
  packagesIntro: {
    title: { en: "All-Inclusive Galápagos, done the local way", es: "Galápagos Todo Incluido, a la manera local" },
    body: {
      en: "No middlemen, no crowds, no kayaks-by-numbers. Every package is hosted by our own family and crew — accommodation, meals, guided tours, transfers and airport pickup, all handled so you only think about the wildlife.",
      es: "Sin intermediarios, sin multitudes. Cada paquete es atendido por nuestra propia familia y tripulación — alojamiento, comidas, tours guiados, traslados y recogida en el aeropuerto, todo resuelto para que solo pienses en la vida silvestre."
    }
  },
  packages: [
    {
      id: "p3",
      img: "assets/img/lagoon.jpg",
      days: { en: "4 Days", es: "4 Días" }, nights: { en: "3 Nights", es: "3 Noches" },
      price: 3499, popular: false, minGuests: 2,
      name: { en: "Island Escape", es: "Escape Isleño" },
      blurb: { en: "A perfect first taste of San Cristóbal.", es: "Una primera probada perfecta de San Cristóbal." },
      includes: [
        { en: "Boutique accommodation (3 nights)", es: "Alojamiento boutique (3 noches)" },
        { en: "All meals & local cuisine", es: "Todas las comidas y cocina local" },
        { en: "Kicker Rock (León Dormido) tour", es: "Tour Kicker Rock (León Dormido)" },
        { en: "San Cristóbal 360° tour", es: "Tour San Cristóbal 360°" },
        { en: "Galápagos flight (GYE/UIO) & all island transport", es: "Vuelo a Galápagos (GYE/UIO) y todo el transporte en la isla" }
      ]
    },
    {
      id: "p4",
      img: "assets/img/kicker-day.jpg",
      days: { en: "5 Days", es: "5 Días" }, nights: { en: "4 Nights", es: "4 Noches" },
      price: 3999, popular: true, minGuests: 2,
      name: { en: "Hook Signature", es: "Hook Signature" },
      blurb: { en: "Our most-loved balance of ocean & land.", es: "Nuestro equilibrio más querido de mar y tierra." },
      includes: [
        { en: "Boutique accommodation (4 nights)", es: "Alojamiento boutique (4 noches)" },
        { en: "All meals & local cuisine", es: "Todas las comidas y cocina local" },
        { en: "Kicker Rock & 360° tours", es: "Tours Kicker Rock y 360°" },
        { en: "Half-day sport fishing", es: "Pesca deportiva de medio día" },
        { en: "Highlands & El Junco lagoon", es: "Tierras altas y laguna El Junco" },
        { en: "Galápagos flight (GYE/UIO) & all island transport", es: "Vuelo a Galápagos (GYE/UIO) y todo el transporte en la isla" }
      ]
    },
    {
      id: "p7",
      img: "assets/img/sea-cave.jpg",
      days: { en: "7 Days", es: "7 Días" }, nights: { en: "6 Nights", es: "6 Noches" },
      price: 4799, popular: false, minGuests: 2,
      name: { en: "Wild Galápagos", es: "Galápagos Salvaje" },
      blurb: { en: "The full enchanted-isles immersion.", es: "La inmersión completa en las islas encantadas." },
      includes: [
        { en: "Boutique accommodation (6 nights)", es: "Alojamiento boutique (6 noches)" },
        { en: "All meals & local cuisine", es: "Todas las comidas y cocina local" },
        { en: "Kicker Rock, 360° & Punta Pitt", es: "Kicker Rock, 360° y Punta Pitt" },
        { en: "Full day of sport fishing", es: "Día completo de pesca deportiva" },
        { en: "Discovery diving day", es: "Día de buceo de descubrimiento" },
        { en: "Highlands, beaches & snorkeling", es: "Tierras altas, playas y snorkel" },
        { en: "Galápagos flight (GYE/UIO) & all island transport", es: "Vuelo a Galápagos (GYE/UIO) y todo el transporte en la isla" }
      ]
    },
    {
      id: "p8sc",
      img: "assets/img/kicker-sunrise.jpg",
      days: { en: "8 Days", es: "8 Días" }, nights: { en: "7 Nights", es: "7 Noches" },
      price: 5319, popular: false, minGuests: 2,
      name: { en: "Island Hopper — Santa Cruz & San Cristóbal", es: "Island Hopper — Santa Cruz y San Cristóbal" },
      blurb: { en: "Two iconic islands in one week-long journey.", es: "Dos islas icónicas en un viaje de una semana." },
      includes: [
        { en: "7 nights 3-star accommodation", es: "7 noches de alojamiento 3 estrellas" },
        { en: "12 meals (7 breakfasts · 5 lunches)", es: "12 comidas (7 desayunos · 5 almuerzos)" },
        { en: "Tortuga Bay & Charles Darwin Station", es: "Tortuga Bay y Estación Charles Darwin" },
        { en: "Bartolomé / North Seymour boat day", es: "Día de bote a Bartolomé / North Seymour" },
        { en: "Punta Pitt, Kicker Rock & El Junco", es: "Punta Pitt, Kicker Rock y El Junco" },
        { en: "Galápagos flight, inter-island ferry & transport", es: "Vuelo a Galápagos, ferry inter-islas y transporte" }
      ]
    },
    {
      id: "p8is",
      img: "assets/img/sea-cave.jpg",
      days: { en: "8 Days", es: "8 Días" }, nights: { en: "7 Nights", es: "7 Noches" },
      price: 5319, popular: false, minGuests: 2,
      name: { en: "Island Hopper — Santa Cruz & Isabela", es: "Island Hopper — Santa Cruz e Isabela" },
      blurb: { en: "From Tortuga Bay to the Sierra Negra volcano.", es: "De Tortuga Bay al volcán Sierra Negra." },
      includes: [
        { en: "7 nights 3-star accommodation", es: "7 noches de alojamiento 3 estrellas" },
        { en: "11 meals (7 breakfasts · 4 lunches)", es: "11 comidas (7 desayunos · 4 almuerzos)" },
        { en: "Tortuga Bay & Charles Darwin Station", es: "Tortuga Bay y Estación Charles Darwin" },
        { en: "Bartolomé / North Seymour boat day", es: "Día de bote a Bartolomé / North Seymour" },
        { en: "Sierra Negra volcano & Las Tintoreras", es: "Volcán Sierra Negra y Las Tintoreras" },
        { en: "Galápagos flight, inter-island ferries & transport", es: "Vuelo a Galápagos, ferries inter-islas y transporte" }
      ]
    }
  ],

  pkgNote: {
    en: "International flights to Ecuador are not included. We cover your round-trip flight from Quito (UIO) or Guayaquil (GYE) to Galápagos plus all in-island transport.",
    es: "Los vuelos internacionales hasta Ecuador no están incluidos. Nosotros cubrimos tu vuelo redondo desde Quito (UIO) o Guayaquil (GYE) a Galápagos y todo el transporte dentro de la isla."
  },

  /* Ya NO hay descuento automático ni nota de grupo en la tarjeta del paquete.
     Los descuentos se configuran desde el panel (owner) y el checkout los aplica
     y muestra solo. 'summary' es solo la etiqueta del descuento real en el
     resumen de reserva. La nota de buceo/pesca vive fuera de los paquetes
     (packages.html). */
  pkgPromo: {
    summary: { en: "Discount", es: "Descuento" }
  },

  mealNote: {
    en: "Breakfast & lunch are included — dinner and alcoholic beverages are not.",
    es: "Desayuno y almuerzo incluidos — la cena y las bebidas alcohólicas no."
  },

  pkgChoice: {
    title: { en: "Choose your marine activity", es: "Elige tu actividad marina" },
    lead: { en: "Your group of 4 picks one ocean experience for the day — go with whatever your crew loves most.", es: "Tu grupo de 4 elige una experiencia oceánica para el día — la que más disfrute tu grupo." },
    options: [
      { en: "Scuba diving", es: "Buceo" },
      { en: "Snorkeling", es: "Snorkel" },
      { en: "Sport fishing", es: "Pesca deportiva", fish: true }
    ],
    fishing: {
      title: { en: "Pick fishing? Dinner is on us", es: "¿Eligen pesca? La cena va por nuestra cuenta" },
      body: { en: "The day's catch goes straight to Restaurant Rosita in San Cristóbal, where a dinner hosted by us awaits — cooked fresh from your own catch of the day.", es: "La pesca del día va directo al Restaurante Rosita, en San Cristóbal, donde los espera una cena de cortesía preparada con su pesca fresca del día." }
    }
  },

  policies: {
    title: { en: "Booking & cancellation policy", es: "Políticas de reserva y cancelación" },
    items: [
      { en: "Full payment is required to reserve your place.", es: "Se requiere el pago completo para reservar tu lugar." },
      { en: "If availability differs from what's shown on the site, we'll notify you within 24 hours of your reservation — you may then pick another date or receive a refund.", es: "Si la disponibilidad difiere de lo mostrado en el sitio, te avisaremos dentro de las 24 horas de tu reserva; podrás elegir otra fecha o recibir un reembolso." },
      { en: "Cancellation 30 days or more before the activity: 100% refund.", es: "Cancelación con 30 días o más de anticipación: reembolso del 100%." },
      { en: "Cancellation 30 days or less before the activity: no refund.", es: "Cancelación con 30 días o menos de anticipación: sin reembolso." },
      { en: "A reservation made and confirmed 30 days or less before the date is non-refundable.", es: "Una reserva hecha y confirmada con 30 días o menos de anticipación no es reembolsable." },
      { en: "Itineraries may change without notice. Española tours run on Thursdays.", es: "Los itinerarios pueden cambiar sin previo aviso. Los tours a Española se realizan los jueves." },
      { en: "Date changes carry additional charges — contact us for any itinerary change.", es: "Los cambios de fecha tienen cargos adicionales; contáctanos para cualquier cambio de itinerario." },
      { en: "Ecuadorian travelers: 15% IVA tax is added to the displayed amount.", es: "Viajeros ecuatorianos: se añade el 15% de IVA al monto mostrado." }
    ]
  },

  /* ---------------- DAY TOURS ---------------- */
  toursIntro: {
    title: { en: "Ocean tours & island adventures", es: "Tours oceánicos y aventuras isleñas" },
    body: {
      en: "Hand-picked day tours around San Cristóbal and the central islands. Small groups, certified local guides, and the boats we run ourselves.",
      es: "Tours de día seleccionados alrededor de San Cristóbal y las islas centrales. Grupos pequeños, guías locales certificados y los botes que operamos nosotros mismos."
    }
  },
  tourCats: [
    { id: "all", en: "All Tours", es: "Todos" },
    { id: "snorkeling", en: "Snorkeling", es: "Snorkel" },
    { id: "adventure", en: "Adventure", es: "Aventura" },
    { id: "diving", en: "Diving", es: "Buceo" },
    { id: "private", en: "Private", es: "Privado" }
  ],
  tours: [
    {
      id: "kicker", cat: "snorkeling", img: "assets/img/kicker-sunrise.jpg",
      name: { en: "Kicker Rock — León Dormido", es: "Kicker Rock — León Dormido" },
      duration: { en: "6–7 hours", es: "6–7 horas" }, tag: { en: "Snorkeling", es: "Snorkel" },
      price: 195, priceLabel: { en: "per person", es: "por persona" },
      blurb: {
        en: "Snorkel the legendary channel between two towering tuff cones — hammerheads, Galápagos sharks, sea turtles and rays glide beneath you.",
        es: "Bucea en el legendario canal entre dos imponentes conos de toba — tiburones martillo, tiburones de Galápagos, tortugas y rayas se deslizan bajo tus pies."
      }
    },
    {
      id: "t360", cat: "adventure", img: "assets/img/highlands-hike.jpg",
      name: { en: "San Cristóbal 360°", es: "San Cristóbal 360°" },
      duration: { en: "8 hours", es: "8 horas" }, tag: { en: "Adventure", es: "Aventura" },
      price: 240, priceLabel: { en: "per person", es: "por persona" },
      blurb: {
        en: "Circumnavigate the island by boat — hidden beaches, snorkeling bays, dramatic cliffs and wildlife colonies all in a single unforgettable day.",
        es: "Rodea la isla en bote — playas escondidas, bahías para snorkel, acantilados imponentes y colonias de fauna en un solo día inolvidable."
      }
    },
    {
      id: "diving", cat: "diving", img: "assets/img/school-fish.jpg",
      name: { en: "Diving Kicker Rock", es: "Buceo en Kicker Rock" },
      duration: { en: "6–7 hours · 2 tanks", es: "6–7 horas · 2 tanques" }, tag: { en: "Diving", es: "Buceo" },
      price: 295, priceLabel: { en: "per person", es: "por persona" },
      blurb: {
        en: "For certified divers: descend the wall of León Dormido amid schooling fish, sharks and the open-water blue. An unforgettable underwater experience.",
        es: "Para buzos certificados: desciende la pared de León Dormido entre cardúmenes, tiburones y el azul de mar abierto. Una experiencia submarina inolvidable."
      }
    },
    {
      id: "lobos", cat: "snorkeling", img: "assets/img/sealion-underwater.jpg",
      name: { en: "Isla Lobos & Playa Ochoa", es: "Isla Lobos y Playa Ochoa" },
      duration: { en: "Half day · 5 hrs", es: "Medio día · 5 hrs" }, tag: { en: "Snorkeling", es: "Snorkel" },
      price: 180, priceLabel: { en: "per person", es: "por persona" },
      blurb: {
        en: "Swim with playful sea lion pups, walk the 850 m wildlife trail past nesting frigatebirds and blue-footed boobies, then relax on Playa Ochoa — the gentlest, most joyful day on the island.",
        es: "Nada con juguetones lobos marinos, recorre el sendero de 850 m entre fragatas y piqueros de patas azules anidando, y relájate en Playa Ochoa — el día más suave y alegre de la isla."
      }
    },
    {
      id: "highlands", cat: "adventure", img: "assets/img/lagoon.jpg",
      name: { en: "Highlands & El Junco", es: "Tierras Altas y El Junco" },
      duration: { en: "Half day", es: "Medio día" }, tag: { en: "Adventure", es: "Aventura" },
      price: 90, priceLabel: { en: "per person", es: "por persona" },
      blurb: {
        en: "Climb to El Junco crater lake, meet giant tortoises at the breeding centre and finish on the white sand of Puerto Chino beach.",
        es: "Sube a la laguna del cráter El Junco, conoce tortugas gigantes en el centro de crianza y termina en la arena blanca de Puerto Chino."
      }
    },
    {
      id: "punta-pitt", cat: "adventure", img: "assets/img/sealion-blacksand.jpg",
      name: { en: "Punta Pitt", es: "Punta Pitt" },
      duration: { en: "Full day", es: "Día completo" }, tag: { en: "Adventure", es: "Aventura" },
      price: 260, priceLabel: { en: "per person", es: "por persona" },
      blurb: {
        en: "The only place on Earth to see all three booby species nesting together — plus pristine snorkeling at the island's wild eastern tip.",
        es: "El único lugar en la Tierra para ver las tres especies de piqueros anidando juntas — más snorkel prístino en el extremo este de la isla."
      }
    },
    {
      id: "espanola", cat: "snorkeling", img: "assets/img/sealion-beach.jpg",
      name: { en: "Española Day Trip", es: "Excursión a Española" },
      duration: { en: "Full day", es: "Día completo" }, tag: { en: "Snorkeling", es: "Snorkel" },
      price: 315, priceLabel: { en: "per person", es: "por persona" },
      blurb: {
        en: "Gardner Bay's powder beaches, waved albatross and curious sea lions — a full-day voyage to the oldest island in the archipelago.",
        es: "Las playas de Gardner Bay, albatros ondulados y curiosos lobos marinos — un viaje de día completo a la isla más antigua del archipiélago."
      }
    },
    {
      id: "private", cat: "private", img: "assets/img/kicker-day.jpg",
      name: { en: "Private Boat Charter", es: "Charter Privado de Bote" },
      duration: { en: "Custom", es: "Personalizado" }, tag: { en: "Private", es: "Privado" },
      price: 0, priceLabel: { en: "Custom quote", es: "Cotización" },
      blurb: {
        en: "Your own boat, crew and itinerary. Perfect for families, couples and groups who want the islands entirely on their own terms.",
        es: "Tu propio bote, tripulación e itinerario. Perfecto para familias, parejas y grupos que quieren las islas a su manera."
      }
    }
  ],

  /* ---------------- SPORT FISHING ---------------- */
  fishing: {
    title: { en: "Sport Fishing", es: "Pesca Deportiva" },
    script: { en: "private expeditions", es: "expediciones privadas" },
    intro: {
      en: "Galápagos is one of the last great frontiers of sport fishing. We run catch-and-release charters with local captains who have fished these seamounts their whole lives.",
      es: "Galápagos es una de las últimas grandes fronteras de la pesca deportiva. Operamos charters de captura y liberación con capitanes locales que han pescado estos montes submarinos toda su vida."
    },
    photos: ["assets/img/fishing-marlin.jpg","assets/img/fishing-mahi.jpg","assets/img/fishing-release.jpg"],
    species: [
      { en: "Striped Marlin", es: "Marlín Rayado" },
      { en: "Blue Marlin", es: "Marlín Azul" },
      { en: "Yellowfin Tuna", es: "Atún Aleta Amarilla" },
      { en: "Wahoo", es: "Wahoo" },
      { en: "Mahi-Mahi (Dorado)", es: "Dorado" },
      { en: "Yellowtail", es: "Jurel" }
    ],
    tripCarousel: ["assets/img/fishing-c1.jpg","assets/img/fishing-c2.jpg","assets/img/fishing-c3.jpg"],
    /* DECISIÓN COMERCIAL: toda la pesca deportiva es SOLO por cotización.
       price:0 hace que el frontend las trate como cotización (sin precio
       público, sin Stripe). El precio real de cobro nunca vive aquí:
       el catálogo del servidor (server/lib/tour-catalog.js) es la fuente. */
    trips: [
      { id: "half", name: { en: "Half-Day Charter", es: "Charter Medio Día" }, duration: { en: "4–5 hrs · per boat", es: "4–5 hrs · por bote" }, price: 0 },
      { id: "full", name: { en: "Full-Day Charter", es: "Charter Día Completo", }, duration: { en: "8 hrs · per boat", es: "8 hrs · por bote" }, price: 0 },
      { id: "expedition", name: { en: "Multi-Day Expedition", es: "Expedición de Varios Días" }, duration: { en: "Custom · per boat", es: "Personalizado · por bote" }, price: 0 }
    ],
    /* peak = best fishing months, good = decent */
    calendar: { peak: [10,11,0,1,2,3], good: [4,9], months: ["J","F","M","A","M","J","J","A","S","O","N","D"] },
    note: { en: "Best season: November – April. All gear, bait, crew and refreshments included. Catch & release for billfish.", es: "Mejor temporada: Noviembre – Abril. Todo el equipo, carnada, tripulación y refrigerios incluidos. Captura y liberación para peces pico." }
  },

  /* ---------------- ABOUT ---------------- */
  about: {
    title: { en: "We are a local family with the ocean in our blood", es: "Somos una familia local con el mar en la sangre" },
    body: {
      en: "Galápagos Hook Adventure was born in San Cristóbal — the easternmost and oldest island, the place Charles Darwin first set foot. For generations our family has fished, guided and protected these waters. We started Hook to share the islands the way we know them: unhurried, authentic and deeply local.\n\nWhen you travel with us there are no middlemen and no scripted bus tours. There is our crew, our boats, and the simple promise of our slogan — local roots, wild experiences.",
      es: "Galápagos Hook Adventure nació en San Cristóbal — la isla más oriental y antigua, donde Charles Darwin pisó por primera vez. Por generaciones nuestra familia ha pescado, guiado y protegido estas aguas. Creamos Hook para compartir las islas como las conocemos: sin prisa, auténticas y profundamente locales.\n\nCuando viajas con nosotros no hay intermediarios ni tours de bus con guion. Está nuestra tripulación, nuestros botes y la simple promesa de nuestro eslogan — raíces locales, experiencias salvajes."
    },
    image: "assets/img/sealion-blacksand.jpg",
    values: [
      { icon: "family", title: { en: "Family", es: "Familia" }, text: { en: "A local family business with strong values.", es: "Un negocio familiar local con valores firmes." } },
      { icon: "experience", title: { en: "Experience", es: "Experiencia" }, text: { en: "Generations of knowledge of these islands.", es: "Generaciones de conocimiento de estas islas." } },
      { icon: "commitment", title: { en: "Commitment", es: "Compromiso" }, text: { en: "We protect the ocean that feeds us.", es: "Protegemos el océano que nos alimenta." } },
      { icon: "community", title: { en: "Community", es: "Comunidad" }, text: { en: "We support our San Cristóbal community.", es: "Apoyamos a nuestra comunidad de San Cristóbal." } }
    ]
  },

  /* ---------------- CONSERVATION ---------------- */
  conservation: {
    title: { en: "We protect what we love", es: "Protegemos lo que amamos" },
    body: {
      en: "The Galápagos gave our family everything. We run small groups, use responsible boats, practice catch-and-release, and reinvest in local conservation so these islands stay wild for the next generation.",
      es: "Galápagos le dio todo a nuestra familia. Operamos en grupos pequeños, usamos botes responsables, practicamos captura y liberación, y reinvertimos en la conservación local para que estas islas sigan salvajes para la próxima generación."
    },
    image: "assets/img/sealion-underwater.jpg",
    pillars: [
      { title: { en: "Small Groups", es: "Grupos Pequeños" }, text: { en: "Lower impact, richer encounters.", es: "Menor impacto, mejores encuentros." } },
      { title: { en: "Catch & Release", es: "Captura y Liberación" }, text: { en: "Every billfish goes back to the blue.", es: "Cada pez pico regresa al azul." } },
      { title: { en: "Plastic-Free Trips", es: "Viajes Sin Plástico" }, text: { en: "Refillable, reef-safe, single-use-free.", es: "Rellenable, seguro para arrecifes, sin un solo uso." } },
      { title: { en: "Local Reinvestment", es: "Reinversión Local" }, text: { en: "A share of every trip funds the islands.", es: "Parte de cada viaje financia las islas." } }
    ]
  },

  /* ---------------- GALLERY ---------------- */
  gallery: [
    "assets/img/sealion-underwater.jpg","assets/img/kicker-sunrise.jpg","assets/img/school-fish.jpg",
    "assets/img/lagoon.jpg","assets/img/fishing-marlin.jpg","assets/img/sea-cave.jpg",
    "assets/img/highlands-hike.jpg","assets/img/sealion-beach.jpg","assets/img/hammerheads.jpg",
    "assets/img/kicker-day.jpg","assets/img/fishing-mahi.jpg","assets/img/sealion-blacksand.jpg"
  ],

  /* ---------------- MAP SPOTS (San Cristóbal) ---------------- */
  mapSpots: [
    { id: "town", x: 60, y: 64, name: { en: "Puerto Baquerizo Moreno", es: "Puerto Baquerizo Moreno" }, desc: { en: "Our home port & meeting point.", es: "Nuestro puerto base y punto de encuentro." } },
    { id: "kicker", x: 30, y: 30, name: { en: "Kicker Rock (León Dormido)", es: "Kicker Rock (León Dormido)" }, desc: { en: "Snorkel & dive with sharks and turtles.", es: "Snorkel y buceo con tiburones y tortugas." } },
    { id: "lobos", x: 47, y: 49, name: { en: "Isla Lobos", es: "Isla Lobos" }, desc: { en: "Sea lion colony & gentle snorkeling.", es: "Colonia de lobos marinos y snorkel suave." } },
    { id: "junco", x: 72, y: 44, name: { en: "El Junco Lagoon", es: "Laguna El Junco" }, desc: { en: "Highland crater lake & giant tortoises.", es: "Laguna de cráter y tortugas gigantes." } },
    { id: "chino", x: 84, y: 70, name: { en: "Puerto Chino", es: "Puerto Chino" }, desc: { en: "White-sand beach in the highlands tour.", es: "Playa de arena blanca en el tour de tierras altas." } },
    { id: "pitt", x: 90, y: 22, name: { en: "Punta Pitt", es: "Punta Pitt" }, desc: { en: "Three booby species nest together.", es: "Las tres especies de piqueros anidan juntas." } }
  ]
};
