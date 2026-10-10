# Esfinge: prompt del vídeo de gestos (Wan 2.2, 10 s, 64 fps)

Imagen de entrada: `prototipos/avatares/esfinge-video/neutral.jpg` (el neutral elegido por Carlos).
Se quedan los 4 clips del 6-oct (reposo, acierto, eufórica, triste). Este vídeo da 4 gestos nuevos: saludo, pensando, sorpresa y una triste alternativa.
Por qué así: el vídeo del 7-oct encadenaba un gesto con el siguiente sin volver a reposo y no se pudo cortar limpio (FILM disuelve la pata en movimientos grandes). Las pausas neutrales son la clave.

## Prompt
```
Static camera, locked-off tripod shot, no zoom, no pan. Plain flat chroma-key green background, evenly lit, no shadows on the background. A cute cartoon sphinx cub with a blue and gold striped headdress sits facing the camera, exactly as in the image. The video has four separate actions, and between them the sphinx always returns to exactly the same calm neutral sitting pose from the image, with the same gentle smile, and stays completely still.

0-0.8 s: sits completely still in the neutral pose.
0.8-2.6 s: GREETING. Raises its right front paw to head height and waves hello twice with a big happy open-mouth smile, then puts the paw back on the ground.
2.6-3.2 s: exact neutral pose, completely still.
3.2-5.0 s: THINKING. Lifts one front paw and rests it under its chin, eyes look up and to the side, eyebrows slightly raised, curious "hmm" expression, then puts the paw back on the ground.
5.0-5.6 s: exact neutral pose, completely still.
5.6-7.2 s: SURPRISE. Both paws stay on the ground. Eyes open very wide, eyebrows shoot up, pointy ears pop up above the headdress, small round open mouth "oh!", head moves back slightly. Then the ears go fully back down and the face relaxes.
7.2-7.8 s: exact neutral pose, ears down, completely still.
7.8-9.4 s: SAD. Both paws stay on the ground, ears stay down. Closes its eyes with drooping eyebrows and a small frown, then opens them with a soft sad look, quiet and contained, no tears, no crying. Then the face relaxes.
9.4-10 s: exact neutral pose, completely still until the end.

Same character, same size, same position and same lighting throughout. Smooth, gentle animation.
```

## Negative prompt (añadir al del Space)
```
camera movement, zoom, pan, background change, shadows on background, extra limbs, extra paws, deformed paws, crying, tears, ears up during sad, blurry, flicker, character moving out of frame
```

## Después
Carlos deja 2-3 tomas en `Downloads`. Se miden los cortes en las pausas (diferencia de píxeles contra el reposo, solo en la silueta; los clips actuales toleran d ≤ 16), hoja de contacto con OK de Carlos, y se montan como los actuales (sin verde, stacked alpha, 480 px, 24 fps, recorte 524 px en 62,54 si el encuadre coincide con el de `original.mp4`).
