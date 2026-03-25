# Guía de Despliegue - SoyProceso Website Backend

## Estado Actual del Despliegue

✅ **COMPLETADO:**
- Repositorio GitHub creado: https://github.com/kevinlopezs/soyproceso-website-backend
- Proyecto Supabase configurado: `xqjcexxltlixiddjbhfh`
- Tablas de base de datos creadas:
  - `profiles` - Perfiles de usuario (sincronizada con auth.users)
  - `blog_categories` - Categorías de blog (4 categorías predeterminadas insertadas)
  - `blog_posts` - Posts del blog con sistema de publicación
  - `blog_post_categories` - Relación muchos-a-muchos posts-categorías
- Políticas RLS (Row Level Security) implementadas
- Funciones PostgreSQL creadas:
  - `handle_new_user()` - Sincroniza nuevos usuarios con tabla profiles
  - `handle_updated_at()` - Actualiza timestamps automáticamente
  - `handle_post_published()` - Establece published_at cuando se publica un post
- Desencadenadores configurados para automatización

🚧 **PENDIENTE DE DESPLIEGUE:**
- Edge Functions (necesitan despliegue manual)
- Configuración de variables de entorno en Supabase
- Pruebas de integración con frontend

## Instrucciones para Completar el Despliegue

### 1. Desplegar Edge Functions

Las Edge Functions están listas en `supabase/functions/`. Para desplegarlas:

```bash
# Instalar Supabase CLI si no lo tienes
npm install -g supabase

# Iniciar sesión en Supabase
supabase login
# Usar el token: sbp_a3a9e9b1d9b6abe9010d241eb41bee5bec050db6

# Navegar al directorio del proyecto
cd /Users/kevinlopez/Documents/Tekaclic/soyproceso-website/soyproceso-website-backend

# Desplegar funciones
supabase functions deploy bunny-upload --project-ref xqjcexxltlixiddjbhfh
supabase functions deploy blog-webhook --project-ref xqjcexxltlixiddjbhfh
```

### 2. Configurar Variables de Entorno en Supabase

En el dashboard de Supabase (https://supabase.com/dashboard/project/xqjcexxltlixiddjbhfh/settings/api):

1. Ir a **Settings > API**
2. Configurar Site URL: `http://localhost:3001`
3. Configurar Additional Redirect URLs:
   - `http://localhost:3001/auth/callback`
   - `http://localhost:3000`
   - `http://localhost:3000/auth/callback`

En **Settings > Edge Functions > Environment Variables**, agregar:

```
BUNNY_NET_USERNAME=soyproceso
BUNNY_NET_PASSWORD_API_ACCESS=07778ffc-3ee1-440c-8e3ead50ce51-e577-4a83
BUNNY_NET_HOSTNAME=br.storage.bunnycdn.com
BUNNY_NET_CDN=https://soyproceso.b-cdn.net
BUNNY_NET_API_KEY=fed9fe59-b7c9-406c-9514-2b9d83a3bac24f4ab0ad-4a0e-4bca-b314-d962d82b1124
WEBHOOK_SECRET=your-secret-key-here  # Para la función blog-webhook
```

### 3. Configurar Autenticación en Supabase

1. Ir a **Authentication > Providers**
2. Habilitar **Email Provider**
3. Configurar confirmación de email según sea necesario
4. Configurar URL de redirección: `http://localhost:3001/auth/callback`

### 4. Integración con Frontend

El frontend necesita configurar el cliente de Supabase:

```javascript
// En el frontend (React/Next.js)
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://xqjcexxltlixiddjbhfh.supabase.co'
const supabaseAnonKey = 'TU_ANON_KEY_AQUI' // Obtener de Settings > API

export const supabase = createClient(supabaseUrl, supabaseAnonKey)
```

### 5. Probar el Sistema

#### Probar Autenticación:
```javascript
// Registro
const { data, error } = await supabase.auth.signUp({
  email: 'usuario@ejemplo.com',
  password: 'contraseña-segura'
})

// Inicio de sesión
const { data, error } = await supabase.auth.signInWithPassword({
  email: 'usuario@ejemplo.com',
  password: 'contraseña-segura'
})

// Verificar que se creó el perfil automáticamente
const { data: profile } = await supabase
  .from('profiles')
  .select('*')
  .eq('id', data.user.id)
  .single()
```

#### Probar Sistema de Blog:
```javascript
// Crear un post (requiere autenticación)
const { data: post, error } = await supabase
  .from('blog_posts')
  .insert({
    title: 'Mi primer post',
    slug: 'mi-primer-post',
    excerpt: 'Resumen del post',
    content: 'Contenido completo del post...',
    author_id: user.id,
    status: 'published'
  })
  .select()
  .single()

// Obtener posts publicados (público)
const { data: posts } = await supabase
  .from('blog_posts')
  .select(`
    *,
    author:profiles(full_name, avatar_url),
    categories:blog_post_categories(category:blog_categories(name, slug))
  `)
  .eq('status', 'published')
  .order('published_at', { ascending: false })
```

#### Probar Subida de Imágenes:
```javascript
// Obtener URL de subida firmada
const { data: uploadData, error } = await supabase.functions.invoke('bunny-upload', {
  body: {
    filename: 'imagen.jpg',
    contentType: 'image/jpeg',
    folder: 'blog-images'
  }
})

// Subir imagen directamente a Bunny.net usando la URL proporcionada
if (uploadData.success) {
  const formData = new FormData()
  formData.append('file', file)
  
  const uploadResponse = await fetch(uploadData.uploadUrl, {
    method: 'PUT',
    body: file,
    headers: {
      'Content-Type': file.type
    }
  })
  
  // La imagen estará disponible en uploadData.cdnUrl
}
```

## URLs Importantes

- **Dashboard de Supabase:** https://supabase.com/dashboard/project/xqjcexxltlixiddjbhfh
- **API URL:** https://xqjcexxltlixiddjbhfh.supabase.co
- **Repositorio GitHub:** https://github.com/kevinlopezs/soyproceso-website-backend
- **Frontend Local:** http://localhost:3001
- **Admin Dashboard:** http://localhost:3001/admin/dashboard
- **Blog:** http://localhost:3001/blog

## Seguridad y Consideraciones

1. **RLS Activado:** Todas las tablas tienen políticas de seguridad activadas
2. **Autenticación Requerida:** Operaciones de escritura requieren autenticación
3. **Roles de Administrador:** Los usuarios con email `@admin.soyproceso.com` tienen acceso completo
4. **Service Role:** Usar clave de service_role solo en el backend, nunca en el frontend
5. **Bunny.net:** Las URLs de subida están firmadas y son de un solo uso

## Solución de Problemas

### Problema: No se crea perfil al registrar usuario
**Solución:** Verificar que el trigger `on_auth_user_created` esté creado en `auth.users`

### Problema: No se puede ver posts publicados
**Solución:** Verificar política RLS "Anyone can view published posts"

### Problema: Error al subir imágenes
**Solución:** Verificar variables de entorno de Bunny.net en Edge Functions

### Problema: No se puede acceder a Edge Functions
**Solución:** Verificar que las funciones estén desplegadas y verify_jwt esté configurado

## Próximos Pasos

1. Desplegar Edge Functions usando Supabase CLI
2. Configurar variables de entorno en el dashboard de Supabase
3. Probar flujo completo de autenticación
4. Integrar con frontend existente
5. Configurar webhooks para notificaciones
6. Implementar sistema de comentarios (opcional)

## Contacto y Soporte

Para problemas técnicos, revisar:
- Documentación de Supabase: https://supabase.com/docs
- API de Bunny.net: https://docs.bunny.net
- Issues en GitHub: https://github.com/kevinlopezs/soyproceso-website-backend/issues

El backend está listo para integración con el frontend. Una vez desplegadas las Edge Functions, el sistema estará completamente funcional.