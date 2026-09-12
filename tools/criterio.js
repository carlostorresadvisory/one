// Criterio de utilidad de las preguntas de ONE. Fijado por Carlos el 12-sep-2026:
// "las preguntas tienen que estar diseñadas para aprender cosas útiles" y "si se
// pueden relacionar con noticias o hechos, mejor". Lo importan el generador, el
// verificador y el filtro de utilidad para que los tres midan lo mismo.

export const PARA_QUIEN =
  'El único jugador es un adulto de 30-40 años, español, formado en finanzas y M&A, culto y ' +
  'curioso, que juega en el móvil 2-5 minutos varias veces al día. No es ingeniero ni académico. ' +
  'Quiere (1) entender cómo funciona el mundo: mecanismos y porqués que explican lo que ve cada día; ' +
  '(2) conversar con criterio: referencias, ideas y debates que un adulto culto reconoce; ' +
  '(3) curiosidades memorables: datos sorprendentes que se quedan y se cuentan; y (4) relacionar lo ' +
  'que aprende con noticias y hechos recientes.';

export const REGLAS_UTILIDAD =
  'Una pregunta es ÚTIL si al responderla (acierte o falle) el jugador entiende algo nuevo del mundo, ' +
  'gana una referencia que podrá usar en una conversación, o se lleva un dato memorable con contexto. ' +
  'La explicación es la mitad del valor: siempre dice el POR QUÉ, no solo el qué, en 1-3 frases claras, y ' +
  'cuando sea posible enlaza con un hecho, debate o noticia reciente (2022-2026) sin que la pregunta ' +
  'dependa de él (la pregunta debe seguir siendo válida dentro de dos años). ' +
  'NO son útiles y quedan PROHIBIDAS: siglas y su significado, números de puerto, versiones de estándares ' +
  'o productos, fechas de lanzamiento de productos, nombres de microarquitecturas o modelos concretos, ' +
  'velocidades o tamaños de especificación, quién fundó o creó una tecnología salvo que la historia sea ' +
  'relevante, fechas sueltas sin causa ni consecuencia, records y superlativos sin mecanismo detrás, ' +
  'clasificaciones taxonómicas de memorieta, definiciones de diccionario, y cualquier cosa que solo ' +
  'sabría un especialista de esa profesión (administrador de sistemas, bibliotecario, taxónomo).';

// Escala de dificultad, redefinida por Carlos el 12-sep: el nivel mide a QUIÉN le resulta
// obvia la pregunta, no lo técnico del tema. Antes el generador ponía "nivel 1" a cosas de
// especialista.
export const NIVELES =
  'Escala de nivel (1-5), obligatoria: nivel 1 = lo que cualquier adulto culto debería saber sin ' +
  'haber estudiado el tema (lo sabe el 80 % de la gente formada); nivel 2 = lo que sabe quien lee ' +
  'prensa y sigue la actualidad; nivel 3 = quien ha leído un libro o varios artículos largos sobre ' +
  'el tema; nivel 4 = aficionado serio que sigue el tema con interés; nivel 5 = solo quien lo ha ' +
  'estudiado o trabaja en ello. Cuando dudes, pon el nivel MÁS ALTO de los dos. Reparte las preguntas ' +
  'entre los niveles pedidos y no etiquetes nunca de nivel 1 o 2 algo que requiera vocabulario técnico.';

// Qué enseña cada área: el generador reparte las preguntas entre estos hilos.
export const HILOS_POR_AREA = {
  economia: [
    'Cómo funcionan la inflación, los tipos de interés y los bancos centrales, y qué se nota en la calle',
    'Mercados, burbujas y crisis (1929, 2008, cripto) y las ideas que las explican',
    'Empresas y modelos de negocio: márgenes, plataformas, por qué unas empresas valen tanto',
    'Comercio, aranceles, cadenas de suministro y geopolítica económica actual',
    'Grandes economistas y sus ideas en una frase (Smith, Keynes, Hayek, Friedman, Piketty)',
    'Sesgos y decisiones: economía del comportamiento aplicada a la vida diaria',
  ],
  historia: [
    'Causas y consecuencias de los grandes giros (caída de Roma, Revolución francesa, guerras mundiales, Guerra Fría)',
    'Cómo el pasado explica el presente: fronteras, conflictos e instituciones actuales',
    'Historia de España y de Europa que sale en las conversaciones',
    'Personajes cuya decisión cambió algo, y por qué la tomaron',
    'Historia económica: dinero, imperios comerciales, revoluciones industriales',
  ],
  ciencia: [
    'Cómo funciona el cuerpo: sueño, alimentación, ejercicio, vacunas, fármacos, envejecimiento',
    'Clima y energía: qué causa qué, qué opciones hay y qué cuestan',
    'Física del día a día: por qué vuela un avión, por qué el cielo es azul, cómo funciona un microondas',
    'Genética, evolución y neurociencia en lo que importa a una persona normal',
    'Espacio: qué sabemos y por qué importa (satélites, Marte, telescopios)',
    'Cómo se sabe lo que se sabe: método, ensayos clínicos, estadística que evita engaños',
  ],
  tecnologia: [
    'Cómo funciona la IA generativa y qué la limita (datos, cómputo, alucinaciones, coste)',
    'Cómo llega Internet a tu móvil y quién controla la infraestructura (cables, nubes, satélites)',
    'Chips y semiconductores: por qué son geopolítica (TSMC, Nvidia, litografía) explicado sin jerga',
    'Cifrado, contraseñas, privacidad y ciberriesgo: lo mínimo que un adulto debe entender',
    'Baterías, coche eléctrico, renovables y redes: qué es posible y qué no todavía',
    'Modelos de negocio del software y las plataformas: por qué son gratis, quién paga',
    'Historia de la tecnología que explica el presente (el PC, la web, el smartphone, las redes sociales)',
  ],
  geografia: [
    'Por qué los países están donde están y son como son: ríos, montañas, clima, recursos',
    'Geopolítica de mapas: estrechos, canales, fronteras calientes, recursos disputados',
    'Demografía: quién crece, quién envejece, migraciones y sus causas',
    'Ciudades y cómo viven: megaciudades, urbanismo, transporte',
    'Clima y catástrofes: dónde y por qué pasan las cosas',
  ],
  filosofia: [
    'Ideas que se usan en una conversación adulta: dilema del tranvía, velo de ignorancia, navaja de Ockham',
    'Grandes preguntas y sus respuestas clásicas: libertad, justicia, felicidad, verdad',
    'Ética aplicada a debates actuales: IA, redes, bioética, desigualdad',
    'Filósofos y su idea central en una frase (Sócrates, Aristóteles, Kant, Nietzsche, Arendt)',
    'Pensar mejor: falacias, sesgos, cómo argumentar',
  ],
  arte: [
    'Por qué una obra importa: qué cambió, qué provocó, qué cuenta (Guernica, Las meninas, el urinario de Duchamp)',
    'Movimientos y qué rompieron: Renacimiento, impresionismo, vanguardias, arte contemporáneo',
    'Cine, música y literatura que un adulto culto reconoce, con el porqué de su peso',
    'Arquitectura y ciudades: por qué los edificios son como son',
    'El mercado del arte y la cultura: subastas, museos, derechos, polémicas recientes',
  ],
  logica: [
    'Razonamiento aplicado: acertijos cortos con solución explicable, sin notación formal',
    'Probabilidad intuitiva y sus trampas (Monty Hall, falacia del jugador, tasa base)',
    'Falacias y trucos retóricos que se ven en debates y noticias',
    'Estadística para no dejarse engañar: correlación, medias, muestras, gráficos tramposos',
    'Teoría de juegos en la vida real: dilema del prisionero, subastas, negociación',
  ],
};

/** Texto listo para pegar en un prompt de sistema: quién, reglas y, si se pasa área, sus hilos. */
export function textoCriterio(area) {
  const hilos = area && HILOS_POR_AREA[area]
    ? `\nHilos del área "${area}" (reparte las preguntas entre ellos): ${HILOS_POR_AREA[area].map((h, i) => `(${i + 1}) ${h}`).join('; ')}.`
    : '';
  return `${PARA_QUIEN}\n${REGLAS_UTILIDAD}\n${NIVELES}${hilos}`;
}
