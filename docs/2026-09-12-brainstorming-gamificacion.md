# Brainstorming: gamificar más y mejorar ONE (12-sep-2026)

Fuentes: tres modelos gratuitos de OpenRouter con lentes distintas (diseño de juegos: nemotron-3-super; ciencia del aprendizaje y benchmark de apps: dots-3-note-preview, tras caer gemma 429 y nex colgado) más síntesis propia. Coste: 0 $. Brief usado: producto actual, límites (un usuario, sin servidor, localStorage, paleta oscura + cian, tono adulto, sesiones de 2-5 min) y la queja principal de Carlos: "no se nota que el sistema aprende" y "parece preparación de examen".

Criterio de orden: primero lo que ataca esa queja y se construye en horas con datos que ya guardamos. Coste S = 1-3 h, M = medio día, L = varios días.

## A. Que se note que aprende (prioridad 1)

| # | Idea | Qué se ve en pantalla | Por qué funciona | Coste |
|---|------|----------------------|------------------|-------|
| A1 | **Sólido vs. reciente** | El radar del hub pasa a tener dos capas: relleno = conocimiento sólido (preguntas en cajas Leitner 3-4, acertadas tras ≥7 días), contorno = reciente (últimas 48 h). En cada área: "Sólido 14 · Reciente 6". | Distingue "saber de verdad" de "acabar de ver" (evita la ilusión de dominio, Hattie). Es la prueba visible de que el sistema recuerda lo que hiciste hace días. Los datos ya existen. | S |
| A2 | **Recuperadas** | Al acertar una pregunta que antes fallaste o marcaste IDK: chip sobrio en el feedback "Recuperada · la fallaste el 9-sep" y contador en el hub. | Convierte el fallo en algo que quieres volver a ver; mentalidad de crecimiento sin ruido. | S |
| A3 | **Pendientes** | Tarjeta en el hub "Pendientes: 7" (falladas/IDK aún no recuperadas). Tocarla abre una partida corta de 3-5 solo con ellas; el número baja delante de ti. | Repetición espaciada enfocada en lo frágil (máximo rendimiento por minuto). Sensación de "cerrar deudas", muy natural para perfil finanzas. | S |
| A4 | **Cierre con repaso** | Al terminar la partida, en vez de solo el resumen: las falladas en tarjetas con la explicación, para pasarlas con swipe antes de salir. | Aprovecha el momento de máxima atención (QuizUp lo hacía bien). | S |
| A5 | **Confianza sin teclado** | Antes de revelar el resultado, dos botones: "Seguro" / "Creo". Seguro + acierto: XP ×1,5. Seguro + fallo: la pregunta entra en Pendientes con prioridad y el feedback lo dice ("estabas seguro"). En el hub, KPI "Calibración 82 %". | Metacognición y calibración (Pashler 2009): la gente que sabe lo que no sabe retiene más. Es una apuesta, mecánica adulta, tipo póker, sin infantilismo. Un toque extra por pregunta: medir si molesta. | S-M |

## B. Motivos para volver hoy y mañana

| # | Idea | Qué se ve | Por qué | Coste |
|---|------|-----------|---------|-------|
| B1 | **Misión del día** | Al abrir: "Hoy: 3 preguntas de Filosofía y Arte" (tus dos áreas más flojas según el radar). Completarla pone un sello en una cinta de días; si faltas un día la cinta se para, no se rompe ni castiga. | Objetivo concreto de 90 segundos, sin culpa. Sustituye la racha punitiva actual por una racha "de sellos". | S |
| B2 | **Retorno** | Si un área lleva ≥7 días sin tocarse, aparece "Vuelve a Geografía: 3 preguntas, bonus". | Repaso espaciado disfrazado de reto. | S |
| B3 | **Boss semanal** (ya en hoja de ruta) | Cada semana, 5 preguntas de nivel alto mezclando tus 2 áreas más débiles; vencerlo sube la nota de esas áreas. | Ciclo semanal además del diario; ataca debilidades. | M |

## C. Ritmo y dinamismo dentro de la partida

| # | Idea | Qué se ve | Por qué | Coste |
|---|------|-----------|---------|-------|
| C1 | **Pista progresiva** | Botón 💡 antes de responder: en test4 elimina una opción errónea; en ordenar fija el primer elemento. Cuesta parte del XP de la pregunta. | Reduce frustración y mantiene el esfuerzo de recuperación (Duolingo, versión sobria). | S |
| C2 | **Ráfaga de 2 minutos** | Modo opcional desde el hub: solo preguntas que ya tienes sólidas (cajas 3-4), cuenta atrás visible, resumen al final. | Fluidez sobre lo ya sabido, sesiones múltiples al día. Nunca con material nuevo: la presión de tiempo perjudica la reflexión (objeción de la lente de aprendizaje, asumida así). | M |
| C3 | **Entrenamiento cruzado** | Partida que intercala obligatoriamente 3 áreas; el combo de áreas distintas seguidas vale más. | Interleaving (Rohrer & Pashler): mejora la discriminación y la transferencia. | S |
| C4 | **Escuchar la explicación** | Botón 🔊 en el feedback: la explicación leída con la voz del sistema (speechSynthesis, sin coste ni red). | "Aprender sin leer" literal; permite usarla andando. | S |

### Añadidos de la cuarta respuesta (nex-n2.5-pro, llegó tarde pero aporta)

| # | Idea | Qué se ve | Por qué | Coste |
|---|------|-----------|---------|-------|
| C5 | **Confusibles** | ONE detecta pares que confundes (opción marcada vs. correcta, misma área) y los presenta juntos: "inflación / estanflación", elige cuál encaja. | Ataca el error real, no el tema en general. | M |
| C6 | **Reverso** | En preguntas con buen historial, la versión inversa: si preguntaba el autor, ahora da la obra y pide el autor. | Recuperación por otro camino; rompe la memoria de "reconozco la pregunta". Necesita generación. | M |
| C7 | **Contrato 48 h** | Tras una difícil, eliges con un chip cuándo quieres volver a verla: "mañana / 48 h / 7 días". Al volver aparece como "reencuentro pendiente". | Compromiso propio, sin castigo; da control al usuario sobre el repaso. | S |
| C8 | **Huella de fragilidad** | Cada acierto se marca sólido o frágil según tiempo de respuesta, confianza y si hubo pista. En el hub se ve la proporción. | Complementa A1 y A5 con un dato que ya podríamos medir (tiempo). | S |

## D. Lo que solo ONE puede hacer (requiere la generación continua, v0.2)

| # | Idea | Qué se ve | Coste |
|---|------|-----------|-------|
| D1 | **Preguntas de conexión** | Una pregunta nueva que enlaza dos cosas que fallaste esta semana en áreas distintas ("la crisis del 29 y la liquidez se relacionan porque…"). | M (pipeline) |
| D2 | **Tarjetas que evolucionan** | Si fallas la misma pregunta por segunda y tercera vez, la explicación añade capas nuevas generadas: anécdota, luego esquema, luego pregunta de nivel superior que la engloba. | M |
| D3 | **Boss a medida** | El boss no mezcla preguntas del banco: la IA genera preguntas que integran tus debilidades concretas. Evolución de B3. | M |
| D4 | **Pistas según tus fuerzas** | La pista de una pregunta de economía se apoya en historia si historia es tu área fuerte. | M |

## E. Descartado (y por qué)

- **Ranking, social, multijugador**: necesita servidor y mete presión de examen.
- **Racha que se rompe, vidas, corazones, cronómetro agresivo**: culpa y arcade infantil. La racha actual se sustituye por B1.
- **Mascotas, avatar/silueta que se rellena, frases de sabiduría aleatorias, medallas "Filósofo"**: recompensa desconectada del aprendizaje o estética infantil.
- **Temas desbloqueables o acento por área**: rompe la paleta fija.
- **Grabarte 15 s explicando la respuesta**: buena ciencia (Fiorella & Mayer), incómodo en la práctica y coste L.
- **Modo relax con sonido de lluvia, mini-historias narrativas, mapa mental con iconos**: fuera de alcance para la fase actual; el radar ya cubre el mapa.

## Propuesta de tanda (v0.1 "que se note")

Una sesión de trabajo, todo con datos que ya guardamos, sin tocar el pipeline: **A1 + A2 + A3 + A4 + B1 + A5**. Después, la generación continua (ya primera en la hoja de ruta) y encima de ella el bloque D.

Pasada adversarial: se hará sobre la spec de lo que Carlos elija, no sobre esta lista abierta (las tres lentes ya se contradicen entre sí donde importa: p. ej. el tiempo límite, resuelto en C2 restringiéndolo a lo ya sabido).
