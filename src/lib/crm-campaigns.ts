import { cache } from "react";
import { createClient } from "@/lib/supabase/server";

// Running campaigns for the client form — the employee picks the one the client came from.
// Reading campaigns is open to every employee (079: «read campaigns» = true), and an error doesn't
// break the client form: the field hides itself when the list is empty.
export const getRunningCampaigns = cache(async (): Promise<{ id: string; name: string }[]> => {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("crm_campaigns")
    .select("id, name")
    .in("status", ["نشطة", "معتمدة"])
    .order("name");
  if (error) {
    console.error("[crm] running campaigns:", error.message);
    return [];
  }
  return (data ?? []) as { id: string; name: string }[];
});
