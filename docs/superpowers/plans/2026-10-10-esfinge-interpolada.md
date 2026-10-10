# Plan — Esfinge: 7 animaciones sacadas de los dos vídeos, con interpolación real (paso 0a)

**Decisiones que mandan** (`docs/PROXIMA-SESION.md`, «Lo último» del 10-oct): no generar vídeo nuevo; cada gesto sale del reposo y vuelve a él solo hacia delante; nada de fundidos visibles, boomerangs, congelaciones ni bucles que se noten; 64 fps; stacked alpha como `prototipos/avatares/esfinge-mp4/`. El montaje con fundidos del 10-oct (`personaje.mp4`) se rechazó: Carlos veía cortes. Criterio de hecho: **Carlos lo ve en el iPhone y no nota ningún corte**.

**Qué hay**: fuentes A (`esfinge-video/original.mp4`) y B (`esfinge-candidatas/video-7oct.mp4`), 640 px, 64 fps, 10 s, fondo verde de croma; matriz de parecido `D.npy` y distancia al neutro `dref.npy` (`saltos.py`); color de B igualado a A (`alineado.json`). Portátil con Intel UHD (Vulkan): RIFE corre en local, gratis.

## Diseño (lo más simple que cumple)

- **Un fotograma ancla N** (el más neutro del reposo de A). El reposo es un bucle que empieza y acaba en N; cada gesto es un clip que empieza en N y acaba en N. Así el reproductor solo cambia de vídeo en N y no hay salto posible.
- **Cada clip = puente de entrada + tramo real hacia delante + puente de salida.** Los puentes son fotogramas nuevos que RIFE inventa entre N y el primer/último fotograma del gesto (elegidos con `dref` como los más cercanos al neutro, para que el movimiento inventado sea corto). Longitud del puente según la distancia (6-20 fotogramas a 64 fps).
- **Reposo**: tramo limpio de A (sin guiños) de ~2,5 s cerrado sobre sí mismo con un puente RIFE (sin fundido). Para no hacer esperar al juego hasta 2,5 s, el reposo marca **puntos de salida** (fotogramas con distancia a N por debajo del paso normal p95): ahí el reproductor puede saltar a un gesto.
- **Alfa propio por croma** (verde dominante → transparente, borde suave, quitar el reflejo verde). El alfa del 6-oct tenía agujeros.

## Entregables

1. **RIFE instalado** — `rife-ncnn-vulkan` (release oficial de nihui, Windows) en `%LOCALAPPDATA%\rife-ncnn-vulkan\`, fuera del repo. *Hecho*: interpola un par de fotogramas de prueba y la salida se ve. *Quién*: yo.
2. **Scripts al día en `tools/esfinge/`** — rutas relativas al repo (fuera la carpeta temporal `videos/`), `saltos.py` regenera `D.npy`/`dref.npy`. *Hecho*: `python saltos.py` corre desde `tools/esfinge/`. `D.npy` no se commitea (se regenera).
3. **`tools/esfinge/gestos.txt`** — tabla gesto → tramo (vídeo, inicio, fin): saludo, pensando, sorpresa «¡oh!» (A 2,3-3,3), triste (B 4,0-6,7), acierto (A 0,1-2,2), euforia (A 3,3-6,2), guiño (A 7,1-7,9). Inicio y fin finos los afina el script con `dref`. *Hecho*: cada tramo revisado en tira de fotogramas por mí.
4. **`tools/esfinge/clips.py`** — saca N, monta reposo y los 7 clips (puentes RIFE + tramo), aplica croma y escribe `prototipos/avatares/esfinge-v2/<gesto>.mp4` (480×960 stacked alpha, 64 fps, H.264, `+faststart`) y `anclas.json` (puntos de salida del reposo). *Hecho*: 8 MP4 y el JSON; ningún clip pasa de ~1 MB.
5. **Control de uniones automático** — `tools/esfinge/revisar.py`: por clip, diferencia entre fotogramas consecutivos; marca todo salto por encima de 1,5 × p95 del movimiento natural y escribe una tira por unión (4 antes · puente · 4 después) en `tools/esfinge/tiras/`. *Hecho*: 0 saltos marcados o cada uno explicado.
6. **Primer juez con visión (OpenRouter gratis)** — `tools/esfinge/juez.mjs`: manda cada tira a un modelo gratis con visión (contenido 🟢: dibujo propio, sin datos) y pide veredicto «natural / se nota» con motivo. *Hecho*: todas las uniones «natural»; las que no, se rehacen (más puente, otro fotograma de enganche) hasta 2 veces y después se me escalan a mí.
7. **Mi revisión final** — miro las tiras y el vídeo de cada clip yo mismo antes de enseñarlo.
8. **Reproductor y página** — `esfinge-v2/player.js` (el de `esfinge-mp4` con: 8 clips, cambio solo en puntos de salida, 64 fps) y `esfinge-v2/index.html` con un botón por gesto y el reposo de fondo. *Hecho*: en Chrome local (tamaño iPhone) cada botón lanza su gesto, vuelve al reposo y la consola no da errores.
9. **Servido al iPhone** — `npm run servir` y la URL `http://<IP>:8765/prototipos/avatares/esfinge-v2/`. **Carlos: abrirla en el iPhone y decir qué uniones nota** (único paso suyo).
10. **Commit en `diseno-secciones`** y relevo actualizado. La integración en `avatar.js` sigue en la fase 4.

## Riesgos y respuesta
- RIFE inventa mal movimientos grandes (cabeza que gira, patas) → enganchar el gesto en su fotograma más neutro y puentes cortos; si aun así se nota, puente en dos tramos pasando por un fotograma real intermedio.
- iGPU lenta → son ~200 fotogramas de puente en total: minutos.
- Las chispas de la euforia o el cian del nemes rompen el croma → umbral sobre «verde que domina a rojo y azul», no sobre tono; revisar sobre fondo oscuro y claro.
- El juez gratis no ve bien detalles → es primer filtro, no sustituto: mando yo y luego Carlos.

## Quién
Yo (Opus, la sesión) ejecuto: hace falta mano y juicio visual. Interpolación: RIFE (programa, gratis). Juez: modelo gratis con visión de OpenRouter. Adversarial de este plan: `delegar.mjs --escalera revisar` (gratis).

## Revisión adversarial (10-oct, `delegar.mjs --escalera revisar`, gratis)
Aplicadas:
- **Cambio de vídeo en iOS con hueco de 2-3 fotogramas** → se precargan todos los clips y el lienzo sigue pintando el último fotograma del clip saliente (que es N) hasta que el entrante tiene su primer fotograma; pintar con `requestVideoFrameCallback` donde exista.
- **64 fps contra pantallas de 60/120 Hz** (se descartarían 4 fotogramas por segundo, tirones) → se conservan **todos** los fotogramas de 64 fps de la fuente, pero el MP4 se marca a 60 fps: el movimiento va un 6 % más lento (imperceptible) y cada fotograma se ve exactamente una vez.
- **Sin pista de audio** (`-an`).
- **Puntos de salida**: umbral = mediana del paso normal (no p95), así saltar de ese fotograma a N es igual que avanzar un fotograma.
- **Gestos grandes** → RIFE `rife-v4.6` y puente en dos tramos por un fotograma real intermedio si hace falta (ya estaba en riesgos).
Descartadas: «Safari no entiende stacked alpha» (no se usa como pista de alfa: el alfa va pintado en la mitad de abajo y lo combina WebGL; funciona desde el 6-oct en su iPhone); MSE/HLS y matriz de iPhones/iOS (sobredimensionado para un prototipo de ~1 MB que se sirve en local; la prueba real es el iPhone de Carlos); métrica SSIM (la diferencia entre fotogramas del entregable 5 cubre lo mismo).
