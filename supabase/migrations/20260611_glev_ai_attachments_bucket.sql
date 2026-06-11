-- glev-ai-attachments: private storage bucket for AI chat image + PDF uploads.
-- Folder structure: {user_id}/{yyyy-mm}/{uuid}-{filename}
-- 5 MB limit per file. RLS: users can only access their own folder.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'glev-ai-attachments',
  'glev-ai-attachments',
  false,
  5242880,
  array['image/jpeg', 'image/png', 'image/heic', 'image/webp', 'application/pdf']
)
on conflict (id) do nothing;

create policy "Users can upload their own attachments"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'glev-ai-attachments'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy "Users can read their own attachments"
on storage.objects for select
to authenticated
using (
  bucket_id = 'glev-ai-attachments'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy "Users can delete their own attachments"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'glev-ai-attachments'
  and (storage.foldername(name))[1] = auth.uid()::text
);
