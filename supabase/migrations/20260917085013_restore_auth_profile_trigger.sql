-- The public-schema baseline contains the trigger function, but schema-only
-- exports scoped to public do not include triggers attached to auth.users.
-- Restore the signup hook explicitly so a clean local/DEV database creates the
-- matching os_profiles row for every new Auth user.
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.os_handle_new_user();
