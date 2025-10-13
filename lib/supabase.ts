import { createClient } from "@supabase/supabase-js";

const bucket = "files-bucket";

export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL as string,
  process.env.NEXT_PUBLIC_SUPABASE_KEY as string
);

export const uploadFileToSupabase = async (file: File, fileName: string) => {
  const timestamp = Date.now();
  const newName = `${timestamp}-${fileName}`;

  const { data } = await supabase.storage.from(bucket).upload(newName, file, {
    cacheControl: "3600",
  });
  if (!data) throw new Error("Failed to upload file");
  return supabase.storage.from(bucket).getPublicUrl(newName).data.publicUrl;
};

export const deleteImage = async (url: string) => {
  let imageName = url.split("/").pop();
  if (!imageName) throw new Error("Invalid file URL");

  imageName = decodeURIComponent(imageName);
  return supabase.storage.from(bucket).remove([imageName]);
};
