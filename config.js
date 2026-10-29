// Configuración de la nube (Supabase). Si se deja vacío, la app funciona solo con los datos de este navegador.
// Ambos valores están en Supabase → Project Settings → API. La "anon key" es pública por diseño:
// lo que protege los datos son las reglas RLS de supabase/migrations/001_regear.sql.
window.REGEAR_CONFIG = {
  supabaseUrl: 'https://gluuvxpesmdirzxmvfnt.supabase.co',
  supabaseAnonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdsdXV2eHBlc21kaXJ6eG12Zm50Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTMyOTgzMTgsImV4cCI6MjEwODg3NDMxOH0.XkVJk3GKHtCV4JSSjXcMKIJmW5mK6NHxoVNKHkDHjKU'
};
