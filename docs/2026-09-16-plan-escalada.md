# ONE — Plan de escalada: de una persona al público general sin depender de un VPS personal (revisado 16-sep-2026, pendiente de decisión de Carlos)

Revisado con pasada adversarial (nemotron-3-ultra:free, 0 €, 15 objeciones) el 16-sep-2026.

Premisas de Carlos: "modelos de pago no van a funcionar para el público general" salvo los **muy muy baratos** (DeepSeek por OpenRouter, GPT nano/mini); gratis primero; protagonismo visual y dopamina como objetivo; no depender del VPS personal.

## 0. Hechos medidos (16-sep-2026)
- Tanda urgente de 10 solo con gratis: 128 s, 9 entregadas, 0 €, 70 llamadas (~35.000 tokens). Cuellos: Gemini agota cuota por la tarde; Groq 8.000 tokens/min; Cerebras 402 hasta activar plan gratuito; NVIDIA saturada.
- Precios OpenRouter (por millón de tokens, entrada/salida): DeepSeek V4 flash 0,06/0,12 $; GPT-5 nano 0,05/0,40 $; Mistral Small 0,05/0,08 $.
- **Corrección tras la revisión**: OpenRouter no da descuento por lote ("batch") para estos proveedores, solo para Anthropic/OpenAI. El "colchón nocturno" no baja el precio, solo la urgencia: se acumulan peticiones y se lanzan de madrugada al precio normal.
- **Coste por tanda de 10 verificada** (25k entrada + 10k salida): DeepSeek ≈ 0,003 $; GPT-5 nano ≈ 0,005 $; Mistral Small ≈ 0,002 $.

## 1. La clave: el banco es compartido, el coste no crece con los usuarios
Una pregunta generada sirve a todos. Leerla es gratis: el banco se sirve como ficheros ya preparados desde un CDN (red que reparte ficheros estáticos cerca del usuario, sin tocar la base de datos — §3), no con consultas fila a fila. Solo un foco de gasto crece con los usuarios:
- **Banco base** (fijo, una vez): 8 áreas × 5 niveles × 250 = 10.000 preguntas ≈ 1.000 tandas ≈ 3-5 $, o gratis en semanas con las cuotas actuales.
- **Almacenamiento en Supabase** (umbral claro): los 10.000 vectores de significado (embeddings, para no duplicar) pesan 10.000 × 1.024 × 4 bytes ≈ **41 MB**. El progreso de un usuario pesa ≈ 300 preguntas × 100 bytes ≈ 30 KB; con 1.000 usuarios, **30 MB**. Con el margen de los índices de Postgres (~3× el dato en crudo), el plan gratis (500 MB) aguanta hasta unos **5.000 usuarios activos**; desde ahí, plan Pro (25 $/mes, 8 GB). Ese es el umbral a vigilar, no las preguntas leídas.
- **Generación a medida** (única que crece con el uso — ver §3): limitada por usuario, con tope diario de gasto.

## 2. Escalera de proveedores (cascada por fase, misma verificación por modelo distinto)
1. **Gratis** (hoy): Gemini flash-lite, Groq, Cerebras (cuando Carlos active el plan gratuito), `:free` de OpenRouter y NVIDIA de noche.
2. **Ultrabarato de pago, solo si el gratis no llega** (429/cuota agotada o cola > 60 s): DeepSeek → GPT-5 nano → Mistral Small. `PERMITIR_PAGO=1` con `TOPE_EUR_DIA` (1 $/día en beta; 5 $/día en público).
3. **Cola nocturna**: las tandas pendientes se acumulan en `tareas_generacion` y se lanzan de madrugada al precio normal (sin descuento batch — §0).
4. Nunca modelos "grandes" de pago en ruta normal; solo para reverificar reportes.

## 3. Arquitectura para el público (sin VPS personal)
- **Cuentas y progreso: Supabase** (Postgres + Auth + Storage), región UE, gratis hasta el umbral de §1 (luego Pro). La base de datos guarda solo `progreso`, `usuarios_areas`, `reportes` y la cola `tareas_generacion`. RLS (seguridad de la base de datos): cada usuario solo lee/escribe su propia fila, nunca una consulta abierta a toda la tabla.
- **Cambio de diseño: el banco no vive en consultas a la base de datos.** Se publica como ficheros JSON versionados por área y nivel en un CDN estático (Supabase Storage o GitHub Pages); la app ya funciona así con `datos/banco.json`. El cliente descarga solo el fichero que toca y lo cachea: cero carga sobre Postgres al leer preguntas.
- **Motor en el cliente, sincronización en el servidor**: la app funciona sin red (localStorage como caché) y sube/baja progreso al abrir y cerrar partida. El estado local de Carlos se importa a su cuenta la primera vez.
- **Generación: el mismo servidor Node, ya en Docker, en hosting gestionado** (Railway Hobby gratis o Fly.io ~3-5 $/mes — el fijo de 5 $/mes de Railway ya no existe). El worker (programa que genera preguntas en segundo plano) despierta por aviso de Supabase Realtime al entrar una tarea, no preguntando cada 5 s. Aceptamos hasta 30 s de arranque en frío: en beta es más barato que un VPS propio, que reproduce la dependencia manual que Carlos quiere evitar. El VPS de IONOS sigue de respaldo mientras no haya usuarios reales.
- **Límites de generación, en servidor**: cada petición se inserta en `tareas_generacion`; RLS solo deja insertar al propio usuario autenticado. El worker cuenta las tandas del día de ese usuario antes de ejecutar y descarta si supera 3 — no en el `localStorage` manipulable. La clave pública solo lee el banco y escribe el progreso propio. Tope global diario de gasto en el worker (`TOPE_EUR_DIA`), además del tope por usuario.
- **Reposición adaptativa, una vez al día**: consulta agregada nocturna calcula el "pozo" por área y nivel — preguntas que ≥ 60 % de los usuarios activos no ha respondido — y dispara generación. Nunca por una acción individual ni por marcar "Baja".
- **Dedup, fuera de la ruta crítica**: comparar por significado (embeddings + `pgvector`, extensión de Postgres para buscar por parecido) es un paso del lote nocturno. Si el proveedor de embeddings falla, la pregunta entra "pendiente de dedup"; en caliente, el filtro es solapamiento de palabras. Validar hoy `CREATE EXTENSION vector`; si falla, el filtro de palabras basta.
- **Analítica**: un proveedor sin cookies (Umami/Plausible), sin campos personales.

## 4. Producto para el público (dopamina y fricción)
- Onboarding de 3 toques: elegir 2-3 áreas, nivel de arranque por 5 preguntas, activar avisos.
- Anillo diario = fichas vencidas hoy (Leitner ya lo calcula), tope 10; celebración CSS de 300 ms al cerrar anillo y subir de nivel.
- Ficha rápida (recuerdo → revelar → Baja/Media/Alta). Peso siempre 1,0, igual que el anillo — no toca `próximo_repaso`; solo añade `tipo=rápido` para analítica, sin romper el repaso de Leitner.
- Avisos push (VAPID) — **asumido**: solo vía PWA instalada desde Safari en un toque, único camino real en iOS ≥ 16.4. Mejora, no dependencia: la app funciona igual sin ellos.
- Beta cerrada por invitación (20-50 personas) con revisión humana de reportes antes de abrir.

## 5. Legal mínimo antes del primer usuario externo
Política de privacidad y términos (RGPD, hosting UE, Supabase como encargado), dominio propio, atribuciones de Commons (ya), edad mínima. Borrado de cuenta en un toque: requiere una Edge Function propia (`delete_account`, programa en la nube de Supabase con permisos elevados) que verifique identidad, revoque sesión y borre progreso/áreas/reportes. Implementarla y probarla **antes** de la beta, con SLA de borrado ≤ 30 días (RGPD Art. 17).

## 6. Orden y estimación honesta por bloque (sesiones de trabajo, no compromiso)
- Cuentas + progreso (Supabase, RLS, migración del estado local): 2-3
- Banco en CDN (JSON versionado por área/nivel): 1
- Worker de generación en hosting gestionado: 1-2
- Límites de servidor + cola canónica: 1
- Dedup nocturno: 1
- Onboarding + push: 1-2
- Legal + beta cerrada: 1

**Total: 8-12 sesiones para la beta cerrada — estimación, no compromiso.**

## 7. Decisiones que necesita Carlos
- Aprobar el escalón de pago ultrabarato y su tope diario (0,50 $/día ahora; 1-5 $/día en beta/público).
- Gratis, freemium o de pago — umbrales reales: hasta 1.000 usuarios, coste despreciable (<1 $/mes); hasta 5.000, plan gratis de Supabase; desde 5.000, Pro (25 $/mes) más hosting del worker.
- Solo PWA o también App Store (la PWA basta para la beta; sin ella no hay push en iOS).
- Plazo objetivo de la beta cerrada.

## Objeciones asumidas
- **#4** (push solo PWA): única ruta real en iOS es la PWA desde Safari; sin app nativa en la beta.
- **#9** (hosting con arranque lento): se acepta hasta 30 s de espera en el worker gestionado en vez de un VPS propio (más barato pero manual y con la dependencia que Carlos quiere evitar); se sube de plan si molesta en la práctica.
- **#11** (onboarding de 5 preguntas, precisión baja): se mantiene por simplicidad en la beta; el objetivo es validar producto, no calibrar el algoritmo; se revisa si hay quejas de nivel mal asignado.
- **#15** (coste marginal no modelado del todo): con 20-50 usuarios en beta, el coste de banda/Realtime es despreciable; el análisis completo se pospone a cuando haya datos reales de uso.
