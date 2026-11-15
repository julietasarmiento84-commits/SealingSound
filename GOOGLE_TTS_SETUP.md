# Voces de Google Cloud Text-to-Speech — guía de configuración

Estado por defecto: **NO conectado**. Sin credenciales, la página usa las voces del dispositivo (Web Speech API) y lo informa en el panel "Idioma y voz".
Las claves nunca van en el HTML: viven como *secret* en Cloudflare y solo las usa la función `functions/api/tts.js`.

## Pasos
1. En Google Cloud Console: crear/elegir un proyecto, activar facturación y habilitar **Cloud Text-to-Speech API**.
2. IAM → Cuentas de servicio → crear una cuenta con el rol **Cloud Text-to-Speech User** → Claves → crear clave **JSON**.
3. Subir este repositorio a **Cloudflare Pages** (la carpeta `functions/` debe estar en la raíz, junto a `index.html`).
4. Pages → Settings → Variables and Secrets → agregar:
   - `GOOGLE_SERVICE_ACCOUNT_JSON` (tipo *Secret*): pegar todo el JSON de la clave.
   - `ALLOWED_ORIGINS` (opcional): ej. `https://tu-sitio.pages.dev`.
5. Volver a desplegar. Al abrir la página, el panel debe decir "Google Cloud Text-to-Speech: conectado" y listar voces es-AR/es-US/es-MX/es-ES/en-US/en-GB femeninas y masculinas.
6. Verificar: `GET /api/tts?voices=es,en` debe devolver `"configured": true`.

## Notas
- GitHub Pages **no** ejecuta funciones: allí solo funcionarán las voces del dispositivo.
- La función limita el texto a 600 caracteres, valida voz e idioma, cachea el audio y rechaza orígenes no permitidos.
- Google cobra por caracteres sintetizados (hay cuota gratuita mensual); revisá precios vigentes. Considerá un límite de gasto/cuota en Google Cloud.
- Si Google falla en medio de una lectura, la página vuelve sola a una voz del dispositivo y avisa.
- Probado: la función con un Google simulado (`tts_mock_test.mjs`). **No fue probada contra Google real** porque este entorno no tiene credenciales ni internet.
