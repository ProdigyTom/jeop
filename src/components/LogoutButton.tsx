"use client";

import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function LogoutButton() {
  const router = useRouter();
  const supabase = createClient();

  async function handleLogout() {
    await supabase.auth.signOut();
    router.push("/");
    router.refresh();
  }

  return (
    <button
      onClick={handleLogout}
      className="px-5 py-2 rounded border-2 text-white font-semibold transition-colors hover:bg-white hover:text-[#060CE9] cursor-pointer"
      style={{ borderColor: "#FFD700" }}
    >
      Sign Out
    </button>
  );
}
