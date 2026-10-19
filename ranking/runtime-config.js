// Viešos duomenų bazės nuostatos (Supabase).
//
// ČIA GALI BŪTI TIK:
//   * projekto URL (https://xxxx.supabase.co)
//   * viešas „anon“ (publishable) raktas – jis sukurtas būti viešas; duomenis saugo RLS taisyklės
//     iš supabase/schema.sql.
//
// NIEKADA čia nedėkite „service_role“ rakto, slaptažodžių ar kitų privilegijuotų duomenų.
// Kol reikšmės tuščios, svetainė rodo tik kalendorių ir tuščią reitingą (jokių išgalvotų duomenų).
export const RUNTIME = {
  supabaseUrl: '',
  supabaseAnonKey: '',
};
