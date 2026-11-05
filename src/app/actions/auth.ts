"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { createServerSupabaseClient } from "@/lib/supabase";

export async function signInAction(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const remember = formData.get("remember") === "on";

  if (remember) {
    // Keep the authentication state in the browser cookie store for the next session.
  }

  if (!email || !password) {
    return { error: "Email and password are required." };
  }

  try {
    const supabase = await createServerSupabaseClient();
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      return { error: error.message };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Authentication is unavailable.";
    return { error: message };
  }

  revalidatePath("/");
  redirect("/customers");
}

export async function signOutAction() {
  try {
    const supabase = await createServerSupabaseClient();
    await supabase.auth.signOut();
  } catch {
    // Intentionally ignore sign-out errors here; the client can still navigate away.
  }

  revalidatePath("/");
  redirect("/login");
}
