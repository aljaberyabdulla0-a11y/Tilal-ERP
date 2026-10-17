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

// Every campaign, for correcting a wrong one in bulk (214) — the right campaign may have ended
// since the lead came in, so the list isn't limited to running ones. Status rides along so an
// ended campaign reads as such in the picker.
export const getAllCampaigns = cache(
  async (): Promise<{ id: string; name: string; status: string | null }[]> => {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("crm_campaigns")
      .select("id, name, status")
      .order("name");
    if (error) {
      console.error("[crm] all campaigns:", error.message);
      return [];
    }
    return (data ?? []) as { id: string; name: string; status: string | null }[];
  }
);
