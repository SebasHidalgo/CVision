import { createClient } from "@supabase/supabase-js";

const bucket = "files-bucket";

export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL as string,
  process.env.NEXT_PUBLIC_SUPABASE_KEY as string,
);

// TODO: the bucket is public and this URL never expires. Move to a private
// bucket with short-lived signed URLs.
export const uploadFileToSupabase = async (file: File, key: string) => {
  const { error } = await supabase.storage.from(bucket).upload(key, file, {
    cacheControl: "3600",
  });

  if (error) {
    console.error("[CVision] Supabase upload failed:", error.message);
    throw new Error("Failed to upload file");
  }

  return supabase.storage.from(bucket).getPublicUrl(key).data.publicUrl;
};

/** Deletes by key, so a failed flow doesn't leave an unreferenced file. */
export const removeFileFromSupabase = async (key: string) => {
  const { error } = await supabase.storage.from(bucket).remove([key]);
  if (error) {
    console.error("[CVision] Supabase remove failed:", error.message);
  }
};

/** Namespaced by user so storage access can be scoped per user. */
export const buildResumeKey = (userId: string) =>
  `cv/${userId}/${crypto.randomUUID()}.pdf`;
