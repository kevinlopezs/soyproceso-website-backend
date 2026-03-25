# SoyProceso Website Backend

Backend Supabase para el sitio web Soy Proceso. Proporciona autenticación, gestión de perfiles de usuario y un sistema completo de blogs con integración Bunny.net para almacenamiento de imágenes.

## Características

- **Autenticación**: Integración con Supabase Auth
- **Perfiles de usuario**: Tabla `profiles` sincronizada con auth.users
- **Sistema de blogs**: Posts, categorías, gestión de contenido
- **Almacenamiento de imágenes**: Integración con Bunny.net CDN
- **Seguridad**: Políticas RLS implementadas
- **API**: Edge Functions para operaciones específicas

## Estructura del proyecto

```
supabase/
├── migrations/      # Migraciones de base de datos
├── functions/       # Edge Functions de Supabase
└── config.toml     # Configuración de Supabase
```

## Configuración

1. Clona el repositorio
2. Copia `.env.example` a `.env` y configura las variables:
   - `SUPABASE_ACCESS_TOKEN`: Token de acceso a Supabase
   - `SUPABASE_PROJECT_ID`: ID del proyecto Supabase
   - Credenciales de Bunny.net

3. Aplica las migraciones:
   ```bash
   # Usando Supabase CLI
   supabase db push
   ```

4. Despliega las Edge Functions:
   ```bash
   supabase functions deploy bunny-upload
   supabase functions deploy blog-webhook
   ```

## Migraciones

Las migraciones se aplican en orden numérico:

1. **00000000000001_create_profiles_table.sql**: Crea la tabla de perfiles y políticas RLS
2. **00000000000002_create_blog_tables.sql**: Crea tablas para el sistema de blogs
3. **00000000000003_create_bunny_integration.sql**: Configura funciones para integración Bunny.net

## Edge Functions

- **bunny-upload**: Genera URLs firmadas para subir imágenes a Bunny.net
- **blog-webhook**: Webhook para procesar eventos del blog

## Integración con Frontend

El frontend (React/Next.js) se comunica con este backend a través de:
- Supabase Client para autenticación y datos
- Edge Functions para operaciones específicas
- Storage de Bunny.net para imágenes

## Desarrollo

Para desarrollo local:
1. Instala Supabase CLI
2. Inicia el entorno local: `supabase start`
3. Aplica migraciones: `supabase db reset`
4. Despliega funciones: `supabase functions deploy --no-verify-jwt`

## Licencia

MIT