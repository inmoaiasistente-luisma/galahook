/* =========================================================
   GALÁPAGOS HOOK ADVENTURE — tour & package detail content
   Bilingual (en/es). Read by app.js to build the "View details" modal.
   Keyed by the tour / package id used in content.js.
   ========================================================= */
window.GHA_DETAILS = {

  /* ===================== DAY TOURS ===================== */
  tours: {

    kicker: {
      gallery: ["assets/img/kicker-sunrise.jpg","assets/img/hammerheads.jpg","assets/img/school-fish.jpg"],
      intro: {
        en: "The signature snorkel of San Cristóbal. Two sheer tuff cones rise 150 m straight out of the open ocean, split by a narrow channel where the big pelagics cruise through — this is the wall dive everyone comes to the island for.",
        es: "El snorkel insignia de San Cristóbal. Dos conos de toba se elevan 150 m desde el mar abierto, separados por un canal angosto por donde cruzan los grandes pelágicos — la pared que todos vienen a la isla a ver."
      },
      highlights: [
        { en: "Snorkel the open-ocean channel between the two monoliths", es: "Snorkel en el canal de mar abierto entre los dos monolitos" },
        { en: "Hammerheads, Galápagos sharks, sea turtles & rays", es: "Tiburones martillo, tiburones de Galápagos, tortugas y rayas" },
        { en: "Schools of fish along a dramatic vertical wall", es: "Cardúmenes a lo largo de una espectacular pared vertical" },
        { en: "Beach stop on the way back to relax & swim", es: "Parada en playa de regreso para relajarse y nadar" }
      ],
      agenda: [
        { title: { en: "8:00 AM · Depart Puerto Baquerizo Moreno", es: "8:00 AM · Salida de Puerto Baquerizo Moreno" }, body: { en: "Pickup at the pier and a scenic 40-minute boat ride out to León Dormido with your local guide and crew.", es: "Recogida en el muelle y un paseo escénico de 40 minutos en bote hasta León Dormido con tu guía y tripulación local." } },
        { title: { en: "Snorkel the channel", es: "Snorkel en el canal" }, body: { en: "Two guided drifts through the channel — wetsuits and snorkel gear included. Keep your eyes on the blue for hammerhead silhouettes.", es: "Dos derivas guiadas por el canal — trajes y equipo de snorkel incluidos. Mantén la vista en el azul para ver siluetas de martillos." } },
        { title: { en: "Lunch on board", es: "Almuerzo a bordo" }, body: { en: "A fresh lunch is served on the boat while we reposition for the return.", es: "Se sirve un almuerzo fresco en el bote mientras nos reubicamos para el regreso." } },
        { title: { en: "Beach stop & return", es: "Parada en playa y regreso" }, body: { en: "Stop at an authorized beach to swim and unwind, back in town by late afternoon.", es: "Parada en una playa autorizada para nadar y relajarse, de vuelta en el pueblo al caer la tarde." } }
      ],
      included: [
        { en: "Local certified guide & boat crew", es: "Guía local certificado y tripulación" },
        { en: "Wetsuit & snorkel equipment", es: "Traje de neopreno y equipo de snorkel" },
        { en: "Fresh lunch & water on board", es: "Almuerzo fresco y agua a bordo" },
        { en: "Round-trip pier transfers", es: "Traslados de ida y vuelta al muelle" }
      ],
      notIncluded: [
        { en: "$200 pp National Park entry fee (cash)", es: "Entrada al Parque Nacional $200 pp (efectivo)" },
        { en: "Hotel pickup outside town centre", es: "Recogida fuera del centro del pueblo" },
        { en: "Gratuities for guide & crew", es: "Propinas para guía y tripulación" }
      ],
      facts: {
        duration: { en: "6–7 hours", es: "6–7 horas" },
        group: { en: "Max 16 · small groups", es: "Máx 16 · grupos pequeños" },
        level: { en: "Moderate — open-water swimming", es: "Moderado — nado en mar abierto" },
        start: { en: "Puerto Baquerizo Moreno", es: "Puerto Baquerizo Moreno" }
      }
    },

    t360: {
      gallery: ["assets/img/highlands-hike.jpg","assets/img/kicker-day.jpg","assets/img/sea-cave.jpg"],
      intro: {
        en: "Circle the whole island in a single day. The 360° tour strings together the wild coastline of San Cristóbal — hidden bays, snorkeling spots, towering cliffs and seabird colonies most visitors never reach.",
        es: "Rodea toda la isla en un solo día. El tour 360° une la costa salvaje de San Cristóbal — bahías escondidas, sitios de snorkel, acantilados imponentes y colonias de aves que la mayoría nunca alcanza."
      },
      highlights: [
        { en: "Full circumnavigation of San Cristóbal by boat", es: "Vuelta completa a San Cristóbal en bote" },
        { en: "Snorkel at two of the island's best bays", es: "Snorkel en dos de las mejores bahías de la isla" },
        { en: "Dramatic cliffs, sea caves & blue-footed boobies", es: "Acantilados, cuevas marinas y piqueros de patas azules" },
        { en: "Remote beaches you can only reach by boat", es: "Playas remotas a las que solo se llega por mar" }
      ],
      agenda: [
        { title: { en: "8:00 AM · Set sail", es: "8:00 AM · Zarpamos" }, body: { en: "Depart the main pier and follow the coastline north toward Punta Pitt and the island's wild eastern tip.", es: "Salimos del muelle principal y seguimos la costa al norte hacia Punta Pitt y el extremo este salvaje." } },
        { title: { en: "Snorkel stops", es: "Paradas de snorkel" }, body: { en: "Two guided snorkel stops in sheltered bays — turtles, rays and reef fish in calm, clear water.", es: "Dos paradas de snorkel guiadas en bahías protegidas — tortugas, rayas y peces de arrecife en agua calma y clara." } },
        { title: { en: "Lunch & coastline", es: "Almuerzo y costa" }, body: { en: "Lunch on board as we round the island past sea caves, cliffs and seabird colonies.", es: "Almuerzo a bordo mientras rodeamos la isla entre cuevas marinas, acantilados y colonias de aves." } },
        { title: { en: "Beach & return", es: "Playa y regreso" }, body: { en: "Final swim at a remote beach, returning to town in the late afternoon.", es: "Último baño en una playa remota, regresando al pueblo en la tarde." } }
      ],
      included: [
        { en: "Local certified guide & boat crew", es: "Guía local certificado y tripulación" },
        { en: "Snorkel equipment & wetsuit", es: "Equipo de snorkel y traje" },
        { en: "Lunch, snacks & water on board", es: "Almuerzo, snacks y agua a bordo" },
        { en: "Pier transfers", es: "Traslados al muelle" }
      ],
      notIncluded: [
        { en: "$200 pp National Park entry fee (cash)", es: "Entrada al Parque Nacional $200 pp (efectivo)" },
        { en: "Gratuities for guide & crew", es: "Propinas para guía y tripulación" }
      ],
      facts: {
        duration: { en: "8 hours · full day", es: "8 horas · día completo" },
        group: { en: "Max 16 · small groups", es: "Máx 16 · grupos pequeños" },
        level: { en: "Easy to moderate", es: "Fácil a moderado" },
        start: { en: "Puerto Baquerizo Moreno", es: "Puerto Baquerizo Moreno" }
      }
    },

    diving: {
      gallery: ["assets/img/school-fish.jpg","assets/img/hammerheads.jpg","assets/img/kicker-island.jpg"],
      intro: {
        en: "For certified divers only. Descend the open-water wall of León Dormido into one of the most electric dive sites on the planet — schooling fish, sharks cruising the blue, and the chance of a hammerhead wall.",
        es: "Solo para buzos certificados. Desciende la pared de mar abierto de León Dormido a uno de los sitios de buceo más eléctricos del planeta — cardúmenes, tiburones cruzando el azul y la posibilidad de una pared de martillos."
      },
      highlights: [
        { en: "Two-tank dive at iconic Kicker Rock", es: "Buceo de dos tanques en el icónico Kicker Rock" },
        { en: "Hammerhead & Galápagos shark encounters", es: "Encuentros con martillos y tiburones de Galápagos" },
        { en: "Sea turtles, eagle rays & vast fish schools", es: "Tortugas, rayas águila y enormes cardúmenes" },
        { en: "Open-water wall diving in the blue", es: "Buceo de pared en mar abierto" }
      ],
      agenda: [
        { title: { en: "Morning briefing & departure", es: "Briefing matinal y salida" }, body: { en: "Gear check and dive briefing at the shop, then the boat ride out to León Dormido.", es: "Revisión de equipo y briefing en la tienda, luego el viaje en bote a León Dormido." } },
        { title: { en: "Dive 1 — the channel", es: "Inmersión 1 — el canal" }, body: { en: "Drift the wall and channel watching for sharks and pelagics in the current.", es: "Deriva por la pared y el canal observando tiburones y pelágicos en la corriente." } },
        { title: { en: "Surface interval & lunch", es: "Intervalo de superficie y almuerzo" }, body: { en: "Rest, snacks and lunch on board between dives.", es: "Descanso, snacks y almuerzo a bordo entre inmersiones." } },
        { title: { en: "Dive 2 & return", es: "Inmersión 2 y regreso" }, body: { en: "Second dive on the opposite wall, then back to port by late afternoon.", es: "Segunda inmersión en la pared opuesta, luego de vuelta al puerto en la tarde." } }
      ],
      included: [
        { en: "2 dives with full tank & weights", es: "2 inmersiones con tanque y plomos" },
        { en: "Certified dive guide & boat crew", es: "Divemaster certificado y tripulación" },
        { en: "Lunch, snacks & water on board", es: "Almuerzo, snacks y agua a bordo" }
      ],
      notIncluded: [
        { en: "$200 pp National Park entry fee (cash)", es: "Entrada al Parque Nacional $200 pp (efectivo)" },
        { en: "Full equipment rental (on request)", es: "Alquiler de equipo completo (a pedido)" },
        { en: "Gratuities", es: "Propinas" }
      ],
      facts: {
        duration: { en: "6–7 hours · 2 tanks", es: "6–7 horas · 2 tanques" },
        group: { en: "Small dive groups", es: "Grupos pequeños de buceo" },
        level: { en: "Certified divers (Open Water+)", es: "Buzos certificados (Open Water+)" },
        start: { en: "Puerto Baquerizo Moreno", es: "Puerto Baquerizo Moreno" }
      }
    },

    lobos: {
      gallery: ["assets/img/sealion-underwater.jpg","assets/img/sealion-beach.jpg","assets/img/sealion-blacksand.jpg"],
      intro: {
        en: "The gentlest, most joyful day on the island — and the one families love most. Pass Tijeretas bay, walk the 850 m wildlife trail on Isla Lobos among nesting frigatebirds and blue-footed boobies, snorkel with playful sea lions, then unwind on the white sand of Playa Ochoa.",
        es: "El día más suave y alegre de la isla — y el favorito de las familias. Pasa por la bahía de Tijeretas, recorre el sendero de 850 m en Isla Lobos entre fragatas y piqueros de patas azules anidando, haz snorkel con lobos marinos juguetones y relájate en la arena blanca de Playa Ochoa."
      },
      highlights: [
        { en: "Snorkel with curious, playful sea lion pups", es: "Snorkel con curiosas crías de lobo marino" },
        { en: "850 m wildlife trail on Isla Lobos", es: "Sendero de fauna de 850 m en Isla Lobos" },
        { en: "Nesting frigatebirds & blue-footed boobies", es: "Fragatas y piqueros de patas azules anidando" },
        { en: "Marine iguanas, manta rays & sea turtles", es: "Iguanas marinas, mantarrayas y tortugas" },
        { en: "Tijeretas bay & hill on the way out", es: "Bahía y cerro Tijeretas en el trayecto" },
        { en: "Free time & lunch on Playa Ochoa", es: "Tiempo libre y almuerzo en Playa Ochoa" }
      ],
      agenda: [
        { title: { en: "8:00 AM · Board at Muelle Acuario", es: "8:00 AM · Abordaje en Muelle Acuario" }, body: { en: "Meet at the Acuario passenger pier and board the Speed Pacific I for a scenic coastal cruise.", es: "Encuentro en el muelle de pasajeros Acuario y abordaje en la Speed Pacific I para una navegación costera." } },
        { title: { en: "Tijeretas bay & hill", es: "Bahía y cerro Tijeretas" }, body: { en: "Coastal navigation past Tijeretas with an informative talk from your naturalist guide on its history and wildlife.", es: "Navegación costera por Tijeretas con una charla informativa del guía naturalista sobre su historia y fauna." } },
        { title: { en: "Isla Lobos trail (850 m)", es: "Sendero Isla Lobos (850 m)" }, body: { en: "Dinghy ashore for a guided ~1h45 walk through sandy, arid and volcanic terrain past nesting frigatebirds and boobies — a photographer's dream.", es: "Desembarco en dinghy para una caminata guiada de ~1h45 por terreno arenoso, árido y volcánico entre fragatas y piqueros anidando — un sueño para fotógrafos." } },
        { title: { en: "Snorkel the channel", es: "Snorkel en el canal" }, body: { en: "About 45 minutes snorkeling the natural pool — sea lions, marine iguanas, manta rays, turtles and a spectacular variety of fish.", es: "Unos 45 minutos de snorkel en la piscina natural — lobos marinos, iguanas marinas, mantarrayas, tortugas y una espectacular variedad de peces." } },
        { title: { en: "Playa Ochoa & return", es: "Playa Ochoa y regreso" }, body: { en: "Free time and lunch served on board at Playa Ochoa, arriving back in port around 12:50.", es: "Tiempo libre y almuerzo servido a bordo en Playa Ochoa, regresando al puerto cerca de las 12:50." } }
      ],
      included: [
        { en: "Marine transport (Speed Pacific I)", es: "Transporte marítimo (Speed Pacific I)" },
        { en: "Bilingual naturalist guide (EN/ES)", es: "Guía naturalista bilingüe (EN/ES)" },
        { en: "Lunch on board & seasonal fruit", es: "Almuerzo a bordo y fruta de temporada" },
        { en: "Snorkel equipment (mask, snorkel, fins)", es: "Equipo de snorkel (máscara, tubo, aletas)" },
        { en: "Water, juice & soda + snacks & towels", es: "Agua, jugo y cola + snacks y toallas" }
      ],
      notIncluded: [
        { en: "$200 pp National Park entry fee (cash)", es: "Entrada al Parque Nacional $200 pp (efectivo)" },
        { en: "Wetsuit rental", es: "Alquiler de wetsuit" },
        { en: "Gratuities", es: "Propinas" },
        { en: "Loss or damage to snorkel equipment", es: "Pérdida o daño del equipo de snorkel" }
      ],
      facts: {
        duration: { en: "Half day · 08:00–12:50", es: "Medio día · 08:00–12:50" },
        group: { en: "Max 12 · shared tour", es: "Máx 12 · tour compartido" },
        level: { en: "Easy — great for beginners", es: "Fácil — ideal para principiantes" },
        start: { en: "Muelle Acuario, San Cristóbal", es: "Muelle Acuario, San Cristóbal" }
      }
    },

    highlands: {
      gallery: ["assets/img/lagoon.jpg","assets/img/highlands-hike.jpg","assets/img/sealion-beach.jpg"],
      intro: {
        en: "Trade the coast for the green heart of San Cristóbal. Climb to the El Junco crater lake, meet giant tortoises roaming free at the breeding centre, and finish on the white sand of Puerto Chino.",
        es: "Cambia la costa por el corazón verde de San Cristóbal. Sube a la laguna del cráter El Junco, conoce tortugas gigantes en libertad en el centro de crianza y termina en la arena blanca de Puerto Chino."
      },
      highlights: [
        { en: "El Junco — a freshwater crater lake in the clouds", es: "El Junco — laguna de cráter de agua dulce entre las nubes" },
        { en: "Giant tortoises at the breeding centre", es: "Tortugas gigantes en el centro de crianza" },
        { en: "White-sand Puerto Chino beach", es: "Playa de arena blanca Puerto Chino" },
        { en: "Highland flora, ferns & misty forest", es: "Flora de altura, helechos y bosque nublado" }
      ],
      agenda: [
        { title: { en: "Climb to El Junco", es: "Subida a El Junco" }, body: { en: "Drive up to the highlands and walk the rim of the crater lake — frigatebirds bathe in the fresh water here.", es: "Subimos a las tierras altas y caminamos el borde de la laguna — las fragatas se bañan en el agua dulce." } },
        { title: { en: "Tortoise breeding centre", es: "Centro de crianza de tortugas" }, body: { en: "Meet giant tortoises of all ages and learn how the island protects them.", es: "Conoce tortugas gigantes de todas las edades y cómo la isla las protege." } },
        { title: { en: "Puerto Chino beach", es: "Playa Puerto Chino" }, body: { en: "Short trail down to a pristine white-sand beach to swim and relax before returning.", es: "Sendero corto hasta una playa prístina de arena blanca para nadar y relajarse antes de volver." } }
      ],
      included: [
        { en: "Local certified guide & transport", es: "Guía local certificado y transporte" },
        { en: "Light lunch", es: "Almuerzo ligero" },
        { en: "Water on the trail", es: "Agua en el recorrido" }
      ],
      notIncluded: [
        { en: "$200 pp National Park entry fee (cash)", es: "Entrada al Parque Nacional $200 pp (efectivo)" },
        { en: "Gratuities", es: "Propinas" }
      ],
      facts: {
        duration: { en: "Half day · 4–5 hours", es: "Medio día · 4–5 horas" },
        group: { en: "Max 16 · family friendly", es: "Máx 16 · apto para familias" },
        level: { en: "Easy — light walking", es: "Fácil — caminata ligera" },
        start: { en: "Puerto Baquerizo Moreno", es: "Puerto Baquerizo Moreno" }
      }
    },

    "punta-pitt": {
      gallery: ["assets/img/sealion-blacksand.jpg","assets/img/kicker-day.jpg","assets/img/school-fish.jpg"],
      intro: {
        en: "The wild northeastern tip of San Cristóbal — and the only place on Earth where all three Galápagos booby species nest side by side. Pair that with pristine snorkeling along an eroded volcanic point.",
        es: "El extremo noreste salvaje de San Cristóbal — y el único lugar en la Tierra donde las tres especies de piqueros de Galápagos anidan juntas. Súmale snorkel prístino a lo largo de una punta volcánica erosionada."
      },
      highlights: [
        { en: "All three booby species nesting together", es: "Las tres especies de piqueros anidando juntas" },
        { en: "Pristine snorkeling off an eroded point", es: "Snorkel prístino frente a una punta erosionada" },
        { en: "Guided walk through the seabird colony", es: "Caminata guiada por la colonia de aves marinas" },
        { en: "Remote, low-traffic corner of the island", es: "Rincón remoto y poco visitado de la isla" }
      ],
      agenda: [
        { title: { en: "Boat to Punta Pitt", es: "Bote a Punta Pitt" }, body: { en: "Cruise to the northeastern tip, watching the coastline change to red and ochre tuff.", es: "Navegamos hasta el extremo noreste viendo la costa volverse de toba roja y ocre." } },
        { title: { en: "Snorkel the point", es: "Snorkel en la punta" }, body: { en: "Snorkel along the eroded rock for pelagics, turtles and rays.", es: "Snorkel a lo largo de la roca erosionada por pelágicos, tortugas y rayas." } },
        { title: { en: "Colony walk & lunch", es: "Caminata por la colonia y almuerzo" }, body: { en: "Guided land walk among nesting boobies, lunch on board, then the return.", es: "Caminata guiada entre piqueros anidando, almuerzo a bordo y regreso." } }
      ],
      included: [
        { en: "Local certified guide & boat crew", es: "Guía local certificado y tripulación" },
        { en: "Snorkel equipment & wetsuit", es: "Equipo de snorkel y traje" },
        { en: "Lunch & water on board", es: "Almuerzo y agua a bordo" }
      ],
      notIncluded: [
        { en: "$200 pp National Park entry fee (cash)", es: "Entrada al Parque Nacional $200 pp (efectivo)" },
        { en: "Gratuities", es: "Propinas" }
      ],
      facts: {
        duration: { en: "Full day", es: "Día completo" },
        group: { en: "Max 16 · small groups", es: "Máx 16 · grupos pequeños" },
        level: { en: "Moderate", es: "Moderado" },
        start: { en: "Puerto Baquerizo Moreno", es: "Puerto Baquerizo Moreno" }
      }
    },

    espanola: {
      gallery: ["assets/img/sealion-beach.jpg","assets/img/sealion-blacksand.jpg","assets/img/lagoon.jpg"],
      intro: {
        en: "A full-day voyage to the oldest island in the archipelago. Española is ringed by sheer cliffs and powder-white beaches, and from April to December it hosts the only waved albatross colony on Earth.",
        es: "Un viaje de día completo a la isla más antigua del archipiélago. Española está rodeada de acantilados y playas de arena blanca, y de abril a diciembre alberga la única colonia de albatros ondulados del planeta."
      },
      highlights: [
        { en: "Gardner Bay's powder-white beach", es: "La playa de arena blanca de Gardner Bay" },
        { en: "Waved albatross colony (Apr–Dec)", es: "Colonia de albatros ondulados (abr–dic)" },
        { en: "Curious sea lions & marine iguanas", es: "Lobos marinos curiosos e iguanas marinas" },
        { en: "Snorkeling in crystal-clear water", es: "Snorkel en agua cristalina" }
      ],
      agenda: [
        { title: { en: "Early crossing", es: "Travesía temprana" }, body: { en: "About 2 hours by boat to Española — keep watch for dolphins riding the bow.", es: "Unas 2 horas en bote hasta Española — atento a los delfines en la proa." } },
        { title: { en: "Snorkel & beach", es: "Snorkel y playa" }, body: { en: "Snorkel and relax at Gardner Bay among sea lions and tropical fish.", es: "Snorkel y descanso en Gardner Bay entre lobos marinos y peces tropicales." } },
        { title: { en: "Guided walk & return", es: "Caminata guiada y regreso" }, body: { en: "Light hike to see albatross, boobies and iguanas before the voyage home.", es: "Caminata ligera para ver albatros, piqueros e iguanas antes del regreso." } }
      ],
      included: [
        { en: "Local certified guide & boat crew", es: "Guía local certificado y tripulación" },
        { en: "Snorkel equipment & wetsuit", es: "Equipo de snorkel y traje" },
        { en: "Lunch & water on board", es: "Almuerzo y agua a bordo" }
      ],
      notIncluded: [
        { en: "$200 pp National Park entry fee (cash)", es: "Entrada al Parque Nacional $200 pp (efectivo)" },
        { en: "Gratuities", es: "Propinas" }
      ],
      facts: {
        duration: { en: "Full day", es: "Día completo" },
        group: { en: "Max 16 · small groups", es: "Máx 16 · grupos pequeños" },
        level: { en: "Moderate — longer crossing", es: "Moderado — travesía más larga" },
        start: { en: "Puerto Baquerizo Moreno", es: "Puerto Baquerizo Moreno" }
      }
    },

    private: {
      gallery: ["assets/img/kicker-day.jpg","assets/img/sea-cave.jpg","assets/img/fishing-c1.jpg"],
      intro: {
        en: "Your own boat, crew and itinerary — built entirely around you. Perfect for families, couples and groups who want the islands at their own pace, with the flexibility to chase the day's best conditions.",
        es: "Tu propio bote, tripulación e itinerario — armado completamente a tu medida. Perfecto para familias, parejas y grupos que quieren las islas a su ritmo, con la flexibilidad de buscar las mejores condiciones del día."
      },
      highlights: [
        { en: "Private boat & crew, just for your group", es: "Bote y tripulación privados, solo para tu grupo" },
        { en: "Fully custom route & departure time", es: "Ruta y hora de salida totalmente personalizadas" },
        { en: "Mix snorkeling, beaches, wildlife & fishing", es: "Combina snorkel, playas, fauna y pesca" },
        { en: "Ideal for families & special occasions", es: "Ideal para familias y ocasiones especiales" }
      ],
      agenda: [
        { title: { en: "We plan it together", es: "Lo planeamos juntos" }, body: { en: "Tell us who's coming and what you'd love to see — we design the perfect day around your group.", es: "Cuéntanos quiénes vienen y qué te encantaría ver — diseñamos el día perfecto para tu grupo." } },
        { title: { en: "Your day, your pace", es: "Tu día, tu ritmo" }, body: { en: "Snorkel spots, hidden beaches, wildlife and optional fishing — as relaxed or packed as you like.", es: "Sitios de snorkel, playas escondidas, fauna y pesca opcional — tan relajado o lleno como quieras." } }
      ],
      included: [
        { en: "Private boat, captain & crew", es: "Bote, capitán y tripulación privados" },
        { en: "Local certified guide", es: "Guía local certificado" },
        { en: "Snorkel equipment, lunch & water", es: "Equipo de snorkel, almuerzo y agua" }
      ],
      notIncluded: [
        { en: "$200 pp National Park entry fee (cash)", es: "Entrada al Parque Nacional $200 pp (efectivo)" },
        { en: "Gratuities", es: "Propinas" }
      ],
      facts: {
        duration: { en: "Custom · half or full day", es: "Personalizado · medio o día completo" },
        group: { en: "Private — your group only", es: "Privado — solo tu grupo" },
        level: { en: "Any — tailored to you", es: "Cualquiera — a tu medida" },
        start: { en: "Puerto Baquerizo Moreno", es: "Puerto Baquerizo Moreno" }
      }
    }
  },

  /* ===================== PACKAGES ===================== */
  packages: {

    p3: {
      gallery: ["assets/img/lagoon.jpg","assets/img/kicker-sunrise.jpg","assets/img/sealion-beach.jpg"],
      intro: {
        en: "A perfect first taste of San Cristóbal. Four days based in one comfortable hotel, with the island's two unmissable ocean tours and a relaxed pace that lets you actually feel the place — not just tick it off.",
        es: "Una primera probada perfecta de San Cristóbal. Cuatro días en un hotel cómodo, con los dos tours oceánicos imperdibles de la isla y un ritmo relajado que te deja sentir el lugar — no solo tacharlo de la lista."
      },
      highlights: [
        { en: "Snorkel iconic Kicker Rock (León Dormido)", es: "Snorkel en el icónico Kicker Rock (León Dormido)" },
        { en: "Full-island San Cristóbal 360° tour", es: "Tour San Cristóbal 360° de toda la isla" },
        { en: "All meals & local cuisine included", es: "Todas las comidas y cocina local incluidas" },
        { en: "Airport pickup & all transfers handled", es: "Recogida en aeropuerto y todos los traslados" }
      ],
      agenda: [
        { title: { en: "Day 1 · Arrival on San Cristóbal", es: "Día 1 · Llegada a San Cristóbal" }, body: { en: "Airport welcome and transfer to your hotel. Afternoon to settle in, walk the malecón and meet the resident sea lions.", es: "Bienvenida en el aeropuerto y traslado al hotel. Tarde para instalarte, recorrer el malecón y conocer a los lobos marinos del pueblo." } },
        { title: { en: "Day 2 · Kicker Rock (León Dormido)", es: "Día 2 · Kicker Rock (León Dormido)" }, body: { en: "Full-day boat tour to snorkel the legendary channel — hammerheads, sharks, turtles and rays. Beach stop on the way back.", es: "Tour de día completo para hacer snorkel en el legendario canal — martillos, tiburones, tortugas y rayas. Parada en playa al regreso." } },
        { title: { en: "Day 3 · San Cristóbal 360°", es: "Día 3 · San Cristóbal 360°" }, body: { en: "Circle the island by boat: hidden bays, snorkeling, cliffs and seabird colonies, finishing at a remote beach.", es: "Rodea la isla en bote: bahías escondidas, snorkel, acantilados y colonias de aves, terminando en una playa remota." } },
        { title: { en: "Day 4 · Departure", es: "Día 4 · Salida" }, body: { en: "Breakfast and free morning before your transfer to the airport.", es: "Desayuno y mañana libre antes del traslado al aeropuerto." } }
      ],
      included: [
        { en: "3 nights boutique accommodation", es: "3 noches de alojamiento boutique" },
        { en: "All meals & local cuisine", es: "Todas las comidas y cocina local" },
        { en: "Kicker Rock & San Cristóbal 360° tours", es: "Tours Kicker Rock y San Cristóbal 360°" },
        { en: "Local certified naturalist guide", es: "Guía naturalista local certificado" },
        { en: "All transfers & airport pickup", es: "Todos los traslados y recogida en aeropuerto" }
      ],
      notIncluded: [
        { en: "$200 pp National Park entry fee (cash)", es: "Entrada al Parque Nacional $200 pp (efectivo)" },
        { en: "$20 pp Transit Control Card (cash)", es: "Tarjeta de Control de Tránsito $20 pp (efectivo)" },
        { en: "International flights to Ecuador", es: "Vuelos internacionales hasta Ecuador" },
        { en: "Travel insurance & gratuities", es: "Seguro de viaje y propinas" }
      ],
      facts: {
        length: { en: "4 days / 3 nights", es: "4 días / 3 noches" },
        group: { en: "Min 2 guests · small groups", es: "Mín 2 viajeros · grupos pequeños" },
        base: { en: "Puerto Baquerizo Moreno", es: "Puerto Baquerizo Moreno" },
        style: { en: "Relaxed · first-timers", es: "Relajado · primera vez" }
      }
    },

    p4: {
      gallery: ["assets/img/kicker-day.jpg","assets/img/fishing-marlin.jpg","assets/img/highlands-hike.jpg"],
      intro: {
        en: "Our most-loved trip — the balance of ocean and land that keeps people coming back. Five days mixing the island's best snorkeling, a taste of sport fishing and the green highlands, all hosted by our own family.",
        es: "Nuestro viaje más querido — el equilibrio de mar y tierra que hace volver a la gente. Cinco días mezclando el mejor snorkel de la isla, una probada de pesca deportiva y las tierras altas, todo atendido por nuestra familia."
      },
      highlights: [
        { en: "Kicker Rock & San Cristóbal 360° tours", es: "Tours Kicker Rock y San Cristóbal 360°" },
        { en: "Half-day sport fishing with local captains", es: "Pesca deportiva de medio día con capitanes locales" },
        { en: "El Junco crater lake & giant tortoises", es: "Laguna El Junco y tortugas gigantes" },
        { en: "All meals, transfers & airport pickup", es: "Todas las comidas, traslados y recogida" }
      ],
      agenda: [
        { title: { en: "Day 1 · Arrival on San Cristóbal", es: "Día 1 · Llegada a San Cristóbal" }, body: { en: "Airport welcome, transfer and a relaxed first evening on the malecón.", es: "Bienvenida en el aeropuerto, traslado y una primera noche relajada en el malecón." } },
        { title: { en: "Day 2 · Kicker Rock", es: "Día 2 · Kicker Rock" }, body: { en: "Full-day snorkel tour of León Dormido with a beach stop on the return.", es: "Tour de snorkel de día completo en León Dormido con parada en playa al regreso." } },
        { title: { en: "Day 3 · Highlands & El Junco", es: "Día 3 · Tierras altas y El Junco" }, body: { en: "Crater lake walk, giant tortoise breeding centre and Puerto Chino beach.", es: "Caminata por la laguna, centro de crianza de tortugas y playa Puerto Chino." } },
        { title: { en: "Day 4 · Half-day sport fishing", es: "Día 4 · Pesca deportiva medio día" }, body: { en: "Head out with a local captain for tuna, wahoo and mahi — catch-and-release for billfish. Free afternoon.", es: "Sal con un capitán local por atún, wahoo y dorado — captura y liberación para peces pico. Tarde libre." } },
        { title: { en: "Day 5 · San Cristóbal 360° & departure", es: "Día 5 · San Cristóbal 360° y salida" }, body: { en: "Morning island tour where time allows, then transfer to the airport.", es: "Tour de la isla por la mañana si el tiempo lo permite, luego traslado al aeropuerto." } }
      ],
      included: [
        { en: "4 nights boutique accommodation", es: "4 noches de alojamiento boutique" },
        { en: "All meals & local cuisine", es: "Todas las comidas y cocina local" },
        { en: "Kicker Rock, 360° & highlands tours", es: "Tours Kicker Rock, 360° y tierras altas" },
        { en: "Half-day sport fishing charter", es: "Charter de pesca deportiva de medio día" },
        { en: "Local certified naturalist guide", es: "Guía naturalista local certificado" },
        { en: "All transfers & airport pickup", es: "Todos los traslados y recogida en aeropuerto" }
      ],
      notIncluded: [
        { en: "$200 pp National Park entry fee (cash)", es: "Entrada al Parque Nacional $200 pp (efectivo)" },
        { en: "$20 pp Transit Control Card (cash)", es: "Tarjeta de Control de Tránsito $20 pp (efectivo)" },
        { en: "International flights to Ecuador", es: "Vuelos internacionales hasta Ecuador" },
        { en: "Travel insurance & gratuities", es: "Seguro de viaje y propinas" }
      ],
      facts: {
        length: { en: "5 days / 4 nights", es: "5 días / 4 noches" },
        group: { en: "Min 2 guests · small groups", es: "Mín 2 viajeros · grupos pequeños" },
        base: { en: "Puerto Baquerizo Moreno", es: "Puerto Baquerizo Moreno" },
        style: { en: "Ocean & land · most popular", es: "Mar y tierra · el más popular" }
      }
    },

    p7: {
      gallery: ["assets/img/sea-cave.jpg","assets/img/hammerheads.jpg","assets/img/sealion-underwater.jpg"],
      intro: {
        en: "The full enchanted-isles immersion. A week to go deep into San Cristóbal — every signature tour, a day of sport fishing, a discovery dive and time to simply be on island time, all handled by our crew end to end.",
        es: "La inmersión completa en las islas encantadas. Una semana para adentrarte en San Cristóbal — cada tour insignia, un día de pesca deportiva, un buceo de descubrimiento y tiempo para simplemente vivir el ritmo isleño, todo a cargo de nuestra tripulación."
      },
      highlights: [
        { en: "Kicker Rock, 360° & Punta Pitt tours", es: "Tours Kicker Rock, 360° y Punta Pitt" },
        { en: "Full day of sport fishing", es: "Día completo de pesca deportiva" },
        { en: "Discovery diving day", es: "Día de buceo de descubrimiento" },
        { en: "Highlands, beaches & all meals included", es: "Tierras altas, playas y todas las comidas" }
      ],
      agenda: [
        { title: { en: "Day 1 · Arrival on San Cristóbal", es: "Día 1 · Llegada a San Cristóbal" }, body: { en: "Airport welcome, transfer and an easy first evening in town.", es: "Bienvenida en el aeropuerto, traslado y una primera noche tranquila en el pueblo." } },
        { title: { en: "Day 2 · Kicker Rock", es: "Día 2 · Kicker Rock" }, body: { en: "Full-day snorkel at León Dormido with a beach stop.", es: "Snorkel de día completo en León Dormido con parada en playa." } },
        { title: { en: "Day 3 · Punta Pitt", es: "Día 3 · Punta Pitt" }, body: { en: "Boat to the wild eastern tip — all three booby species and pristine snorkeling.", es: "Bote al extremo este salvaje — las tres especies de piqueros y snorkel prístino." } },
        { title: { en: "Day 4 · Highlands & El Junco", es: "Día 4 · Tierras altas y El Junco" }, body: { en: "Crater lake, giant tortoises and Puerto Chino beach. Free afternoon in town.", es: "Laguna, tortugas gigantes y playa Puerto Chino. Tarde libre en el pueblo." } },
        { title: { en: "Day 5 · Discovery diving", es: "Día 5 · Buceo de descubrimiento" }, body: { en: "Guided discovery dive — no certification needed — or upgrade to a two-tank Kicker Rock dive.", es: "Buceo de descubrimiento guiado — sin certificación — o mejora a un buceo de dos tanques en Kicker Rock." } },
        { title: { en: "Day 6 · Full-day sport fishing", es: "Día 6 · Pesca deportiva día completo" }, body: { en: "A full day offshore for marlin, tuna and wahoo with a local captain — catch-and-release for billfish.", es: "Un día completo mar adentro por marlín, atún y wahoo con un capitán local — captura y liberación para peces pico." } },
        { title: { en: "Day 7 · San Cristóbal 360° & departure", es: "Día 7 · San Cristóbal 360° y salida" }, body: { en: "A final island circuit where time allows, then your airport transfer.", es: "Un último circuito de la isla si el tiempo lo permite, luego tu traslado al aeropuerto." } }
      ],
      included: [
        { en: "6 nights boutique accommodation", es: "6 noches de alojamiento boutique" },
        { en: "All meals & local cuisine", es: "Todas las comidas y cocina local" },
        { en: "Kicker Rock, 360° & Punta Pitt tours", es: "Tours Kicker Rock, 360° y Punta Pitt" },
        { en: "Full day of sport fishing", es: "Día completo de pesca deportiva" },
        { en: "Discovery diving day", es: "Día de buceo de descubrimiento" },
        { en: "Local certified naturalist guide", es: "Guía naturalista local certificado" },
        { en: "All transfers & airport pickup", es: "Todos los traslados y recogida en aeropuerto" }
      ],
      notIncluded: [
        { en: "$200 pp National Park entry fee (cash)", es: "Entrada al Parque Nacional $200 pp (efectivo)" },
        { en: "$20 pp Transit Control Card (cash)", es: "Tarjeta de Control de Tránsito $20 pp (efectivo)" },
        { en: "International flights to Ecuador", es: "Vuelos internacionales hasta Ecuador" },
        { en: "Travel insurance & gratuities", es: "Seguro de viaje y propinas" }
      ],
      facts: {
        length: { en: "7 days / 6 nights", es: "7 días / 6 noches" },
        group: { en: "Min 2 guests · small groups", es: "Mín 2 viajeros · grupos pequeños" },
        base: { en: "Puerto Baquerizo Moreno", es: "Puerto Baquerizo Moreno" },
        style: { en: "Full immersion · adventurous", es: "Inmersión completa · aventurero" }
      }
    },

    p8sc: {
      gallery: ["assets/img/highlands-hike.jpg","assets/img/kicker-day.jpg","assets/img/sealion-beach.jpg"],
      intro: {
        en: "Two of the archipelago's most iconic islands in a single week. Start in Santa Cruz — Tortuga Bay, the Charles Darwin Station and wild giant tortoises — then ferry to San Cristóbal for Punta Pitt, Kicker Rock and the El Junco highlands. Comfortable hotels, naturalist guides and every transfer handled.",
        es: "Dos de las islas más icónicas del archipiélago en una sola semana. Empieza en Santa Cruz — Tortuga Bay, la Estación Charles Darwin y tortugas gigantes en libertad — y luego cruza en ferry a San Cristóbal para Punta Pitt, Kicker Rock y las tierras altas de El Junco. Hoteles cómodos, guías naturalistas y todos los traslados resueltos."
      },
      highlights: [
        { en: "Tortuga Bay — one of the world's best beaches", es: "Tortuga Bay — una de las mejores playas del mundo" },
        { en: "Charles Darwin Research Station", es: "Estación Científica Charles Darwin" },
        { en: "Bartolomé or North Seymour boat day", es: "Día de bote a Bartolomé o North Seymour" },
        { en: "Punta Pitt — all three booby species", es: "Punta Pitt — las tres especies de piqueros" },
        { en: "Snorkel iconic Kicker Rock (León Dormido)", es: "Snorkel en el icónico Kicker Rock (León Dormido)" },
        { en: "El Junco crater lake & giant tortoises", es: "Laguna El Junco y tortugas gigantes" }
      ],
      agenda: [
        { title: { en: "Day 1 · Baltra → Santa Cruz", es: "Día 1 · Baltra → Santa Cruz" }, body: { en: "Arrive at Baltra, transfer to Puerto Ayora with a stop in the highlands to see wild giant tortoises. Lunch at a tortoise ranch.", es: "Llegada a Baltra, traslado a Puerto Ayora con parada en las tierras altas para ver tortugas gigantes en libertad. Almuerzo en un rancho de tortugas." } },
        { title: { en: "Day 2 · Santa Cruz", es: "Día 2 · Santa Cruz" }, body: { en: "Light hike to Tortuga Bay — one of the 25 most beautiful beaches on Earth — and the Charles Darwin Research Station.", es: "Caminata ligera a Tortuga Bay — una de las 25 playas más bellas del mundo — y la Estación Científica Charles Darwin." } },
        { title: { en: "Day 3 · Bartolomé or North Seymour", es: "Día 3 · Bartolomé o North Seymour" }, body: { en: "Full boat day: Bartolomé's volcanic viewpoint and snorkeling (turtles, penguins, reef sharks) or North Seymour's land iguanas, frigatebirds and blue-footed boobies.", es: "Día completo de bote: el mirador volcánico de Bartolomé y snorkel (tortugas, pingüinos, tiburones de arrecife) o las iguanas terrestres, fragatas y piqueros de patas azules de North Seymour." } },
        { title: { en: "Day 4 · Santa Cruz → San Cristóbal", es: "Día 4 · Santa Cruz → San Cristóbal" }, body: { en: "Morning ferry to Puerto Baquerizo Moreno — the 'capital of happiness'. Free afternoon to settle in.", es: "Ferry matinal a Puerto Baquerizo Moreno — la 'capital de la felicidad'. Tarde libre para instalarte." } },
        { title: { en: "Day 5 · Punta Pitt", es: "Día 5 · Punta Pitt" }, body: { en: "Boat to the wild northeastern tip — the only place on Earth where all three booby species nest together, plus pristine snorkeling.", es: "Bote al extremo noreste salvaje — el único lugar donde las tres especies de piqueros anidan juntas, más snorkel prístino." } },
        { title: { en: "Day 6 · Kicker Rock (León Dormido)", es: "Día 6 · Kicker Rock (León Dormido)" }, body: { en: "Snorkel the legendary channel between two towering monoliths — hammerheads, sharks, turtles and rays. Beach stop on the way back.", es: "Snorkel en el legendario canal entre dos monolitos — martillos, tiburones, tortugas y rayas. Parada en playa al regreso." } },
        { title: { en: "Day 7 · Highlands & El Junco", es: "Día 7 · Tierras altas y El Junco" }, body: { en: "El Junco crater lake, the giant tortoise breeding centre and a swim at a white-sand beach.", es: "Laguna del cráter El Junco, el centro de crianza de tortugas gigantes y un baño en una playa de arena blanca." } },
        { title: { en: "Day 8 · Departure", es: "Día 8 · Salida" }, body: { en: "A last morning in Puerto Baquerizo Moreno before your transfer to the airport.", es: "Una última mañana en Puerto Baquerizo Moreno antes de tu traslado al aeropuerto." } }
      ],
      included: [
        { en: "7 nights 3-star accommodation", es: "7 noches de alojamiento 3 estrellas" },
        { en: "7 breakfasts & 5 lunches (12 meals)", es: "7 desayunos y 5 almuerzos (12 comidas)" },
        { en: "All excursions in the itinerary", es: "Todas las excursiones del itinerario" },
        { en: "Galápagos National Park naturalist guide", es: "Guía naturalista del Parque Nacional Galápagos" },
        { en: "Inter-island ferry (Santa Cruz ↔ San Cristóbal)", es: "Ferry inter-islas (Santa Cruz ↔ San Cristóbal)" },
        { en: "Baltra & San Cristóbal airport transfers", es: "Traslados a aeropuertos de Baltra y San Cristóbal" }
      ],
      notIncluded: [
        { en: "$200 pp National Park entry fee (cash)", es: "Entrada al Parque Nacional $200 pp (efectivo)" },
        { en: "$20 pp INGALA Transit Control Card (cash)", es: "Tarjeta de Control de Tránsito INGALA $20 pp (efectivo)" },
        { en: "International flights to Ecuador", es: "Vuelos internacionales hasta Ecuador" },
        { en: "Meals not specified in the itinerary", es: "Comidas no especificadas en el itinerario" },
        { en: "Travel insurance & gratuities", es: "Seguro de viaje y propinas" }
      ],
      facts: {
        length: { en: "8 days / 7 nights", es: "8 días / 7 noches" },
        group: { en: "Min 2 guests · small groups", es: "Mín 2 viajeros · grupos pequeños" },
        base: { en: "Santa Cruz & San Cristóbal", es: "Santa Cruz y San Cristóbal" },
        style: { en: "Island hopper · land-based", es: "Island hopper · en tierra" }
      }
    },

    p8is: {
      gallery: ["assets/img/lagoon.jpg","assets/img/school-fish.jpg","assets/img/sealion-underwater.jpg"],
      intro: {
        en: "The two most rewarding islands for landscapes and wildlife. Begin in Santa Cruz with Tortuga Bay and the Charles Darwin Station, then ferry to Isabela — the wild, volcanic giant of the archipelago — to climb Sierra Negra and snorkel the teeming islets of Las Tintoreras.",
        es: "Las dos islas más gratificantes por sus paisajes y fauna. Empieza en Santa Cruz con Tortuga Bay y la Estación Charles Darwin, luego cruza en ferry a Isabela — el gigante volcánico y salvaje del archipiélago — para subir el Sierra Negra y bucear en los islotes llenos de vida de Las Tintoreras."
      },
      highlights: [
        { en: "Tortuga Bay & Charles Darwin Station", es: "Tortuga Bay y Estación Charles Darwin" },
        { en: "Bartolomé or North Seymour boat day", es: "Día de bote a Bartolomé o North Seymour" },
        { en: "Sierra Negra — 2nd-largest crater on Earth", es: "Sierra Negra — el 2º cráter más grande del planeta" },
        { en: "Snorkel Las Tintoreras with sharks & penguins", es: "Snorkel en Las Tintoreras con tiburones y pingüinos" },
        { en: "Penguins, flamingos & marine iguanas", es: "Pingüinos, flamencos e iguanas marinas" },
        { en: "Bike or visit the tortoise centre on Isabela", es: "Bici o centro de tortugas en Isabela" }
      ],
      agenda: [
        { title: { en: "Day 1 · Baltra → Santa Cruz", es: "Día 1 · Baltra → Santa Cruz" }, body: { en: "Arrive at Baltra, transfer to Puerto Ayora with a highlands stop for wild giant tortoises. Lunch at a tortoise ranch.", es: "Llegada a Baltra, traslado a Puerto Ayora con parada en las tierras altas para ver tortugas gigantes. Almuerzo en un rancho de tortugas." } },
        { title: { en: "Day 2 · Santa Cruz", es: "Día 2 · Santa Cruz" }, body: { en: "Light hike to Tortuga Bay and a visit to the Charles Darwin Research Station.", es: "Caminata ligera a Tortuga Bay y visita a la Estación Científica Charles Darwin." } },
        { title: { en: "Day 3 · Bartolomé or North Seymour", es: "Día 3 · Bartolomé o North Seymour" }, body: { en: "Full boat day to Bartolomé's volcanic viewpoint and snorkeling, or North Seymour's iguanas, frigatebirds and boobies.", es: "Día completo de bote al mirador volcánico de Bartolomé y snorkel, o las iguanas, fragatas y piqueros de North Seymour." } },
        { title: { en: "Day 4 · Santa Cruz → Isabela", es: "Día 4 · Santa Cruz → Isabela" }, body: { en: "Morning ferry to Puerto Villamil. Afternoon: the tortoise centre or a bike ride to El Muro de las Lágrimas.", es: "Ferry matinal a Puerto Villamil. Tarde: el centro de tortugas o una ruta en bici a El Muro de las Lágrimas." } },
        { title: { en: "Day 5 · Isabela", es: "Día 5 · Isabela" }, body: { en: "Light hike through dramatic volcanic rock formations and snorkeling with sharks, sea lions and turtles.", es: "Caminata ligera por espectaculares formaciones de roca volcánica y snorkel con tiburones, lobos marinos y tortugas." } },
        { title: { en: "Day 6 · Sierra Negra volcano", es: "Día 6 · Volcán Sierra Negra" }, body: { en: "Hike (or horseback ride) up Sierra Negra — at 1,124 m and a 10 km crater, the second-largest volcanic crater in the world.", es: "Caminata (o cabalgata) al Sierra Negra — a 1.124 m y con un cráter de 10 km, el segundo cráter volcánico más grande del mundo." } },
        { title: { en: "Day 7 · Las Tintoreras", es: "Día 7 · Las Tintoreras" }, body: { en: "Explore the Las Tintoreras islets — sea lion and penguin colonies, and snorkeling with white-tip reef sharks and turtles.", es: "Explora los islotes de Las Tintoreras — colonias de lobos marinos y pingüinos, y snorkel con tiburones de arrecife y tortugas." } },
        { title: { en: "Day 8 · Isabela → Baltra", es: "Día 8 · Isabela → Baltra" }, body: { en: "Early transfer back across Santa Cruz to Baltra airport for your onward flight.", es: "Traslado temprano de regreso por Santa Cruz hasta el aeropuerto de Baltra para tu vuelo de salida." } }
      ],
      included: [
        { en: "7 nights 3-star accommodation", es: "7 noches de alojamiento 3 estrellas" },
        { en: "7 breakfasts & 4 lunches (11 meals)", es: "7 desayunos y 4 almuerzos (11 comidas)" },
        { en: "All excursions in the itinerary", es: "Todas las excursiones del itinerario" },
        { en: "Galápagos National Park naturalist guide", es: "Guía naturalista del Parque Nacional Galápagos" },
        { en: "2 inter-island ferries (Santa Cruz ↔ Isabela)", es: "2 ferries inter-islas (Santa Cruz ↔ Isabela)" },
        { en: "Baltra airport & all land transfers", es: "Aeropuerto de Baltra y todos los traslados" }
      ],
      notIncluded: [
        { en: "$200 pp National Park entry fee (cash)", es: "Entrada al Parque Nacional $200 pp (efectivo)" },
        { en: "$20 pp INGALA Transit Control Card (cash)", es: "Tarjeta de Control de Tránsito INGALA $20 pp (efectivo)" },
        { en: "International flights to Ecuador", es: "Vuelos internacionales hasta Ecuador" },
        { en: "Meals not specified in the itinerary", es: "Comidas no especificadas en el itinerario" },
        { en: "Travel insurance & gratuities", es: "Seguro de viaje y propinas" }
      ],
      facts: {
        length: { en: "8 days / 7 nights", es: "8 días / 7 noches" },
        group: { en: "Min 2 guests · small groups", es: "Mín 2 viajeros · grupos pequeños" },
        base: { en: "Santa Cruz & Isabela", es: "Santa Cruz e Isabela" },
        style: { en: "Island hopper · land-based", es: "Island hopper · en tierra" }
      }
    }
  }
};
