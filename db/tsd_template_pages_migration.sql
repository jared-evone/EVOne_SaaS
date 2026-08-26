-- Overlay template pages: base64-in-jsonb -> Storage URLs.
-- Phase 1 (DONE): 19 page images uploaded to tsd-form-photos/template-pages/{id}/.
-- Phase 2 (APPLIED): snapshot 'pre-template-pages' taken (base64 originals
-- recoverable from backup.tsd_form_templates_snapshot), the updates below ran in
-- one transaction, and the store's mount payload dropped 4,701 KB -> 70 KB with
-- all 19 page URLs verified reachable.

update tsd_form_templates set template = jsonb_set(template, '{pages,0,imageSrc}', to_jsonb('https://swzorezjlkovvgrcntrs.supabase.co/storage/v1/object/public/tsd-form-photos/template-pages/tpl-1784183331291/page-0.png'::text)) where id = 'tpl-1784183331291';
update tsd_form_templates set template = jsonb_set(template, '{imageSrc}', to_jsonb('https://swzorezjlkovvgrcntrs.supabase.co/storage/v1/object/public/tsd-form-photos/template-pages/tpl-1784183331291/page-0.png'::text)) where id = 'tpl-1784183331291';
update tsd_form_templates set template = jsonb_set(template, '{pages,1,imageSrc}', to_jsonb('https://swzorezjlkovvgrcntrs.supabase.co/storage/v1/object/public/tsd-form-photos/template-pages/tpl-1784183331291/page-1.png'::text)) where id = 'tpl-1784183331291';
update tsd_form_templates set updated_at = now() where id = 'tpl-1784183331291';
update tsd_form_templates set template = jsonb_set(template, '{pages,0,imageSrc}', to_jsonb('https://swzorezjlkovvgrcntrs.supabase.co/storage/v1/object/public/tsd-form-photos/template-pages/tpl-1785834810517/page-0.png'::text)) where id = 'tpl-1785834810517';
update tsd_form_templates set template = jsonb_set(template, '{imageSrc}', to_jsonb('https://swzorezjlkovvgrcntrs.supabase.co/storage/v1/object/public/tsd-form-photos/template-pages/tpl-1785834810517/page-0.png'::text)) where id = 'tpl-1785834810517';
update tsd_form_templates set template = jsonb_set(template, '{pages,1,imageSrc}', to_jsonb('https://swzorezjlkovvgrcntrs.supabase.co/storage/v1/object/public/tsd-form-photos/template-pages/tpl-1785834810517/page-1.png'::text)) where id = 'tpl-1785834810517';
update tsd_form_templates set template = jsonb_set(template, '{pages,2,imageSrc}', to_jsonb('https://swzorezjlkovvgrcntrs.supabase.co/storage/v1/object/public/tsd-form-photos/template-pages/tpl-1785834810517/page-2.png'::text)) where id = 'tpl-1785834810517';
update tsd_form_templates set template = jsonb_set(template, '{pages,3,imageSrc}', to_jsonb('https://swzorezjlkovvgrcntrs.supabase.co/storage/v1/object/public/tsd-form-photos/template-pages/tpl-1785834810517/page-3.png'::text)) where id = 'tpl-1785834810517';
update tsd_form_templates set template = jsonb_set(template, '{pages,4,imageSrc}', to_jsonb('https://swzorezjlkovvgrcntrs.supabase.co/storage/v1/object/public/tsd-form-photos/template-pages/tpl-1785834810517/page-4.png'::text)) where id = 'tpl-1785834810517';
update tsd_form_templates set template = jsonb_set(template, '{pages,5,imageSrc}', to_jsonb('https://swzorezjlkovvgrcntrs.supabase.co/storage/v1/object/public/tsd-form-photos/template-pages/tpl-1785834810517/page-5.png'::text)) where id = 'tpl-1785834810517';
update tsd_form_templates set template = jsonb_set(template, '{pages,6,imageSrc}', to_jsonb('https://swzorezjlkovvgrcntrs.supabase.co/storage/v1/object/public/tsd-form-photos/template-pages/tpl-1785834810517/page-6.png'::text)) where id = 'tpl-1785834810517';
update tsd_form_templates set template = jsonb_set(template, '{pages,7,imageSrc}', to_jsonb('https://swzorezjlkovvgrcntrs.supabase.co/storage/v1/object/public/tsd-form-photos/template-pages/tpl-1785834810517/page-7.png'::text)) where id = 'tpl-1785834810517';
update tsd_form_templates set template = jsonb_set(template, '{pages,8,imageSrc}', to_jsonb('https://swzorezjlkovvgrcntrs.supabase.co/storage/v1/object/public/tsd-form-photos/template-pages/tpl-1785834810517/page-8.png'::text)) where id = 'tpl-1785834810517';
update tsd_form_templates set template = jsonb_set(template, '{pages,9,imageSrc}', to_jsonb('https://swzorezjlkovvgrcntrs.supabase.co/storage/v1/object/public/tsd-form-photos/template-pages/tpl-1785834810517/page-9.png'::text)) where id = 'tpl-1785834810517';
update tsd_form_templates set updated_at = now() where id = 'tpl-1785834810517';
update tsd_form_templates set template = jsonb_set(template, '{pages,0,imageSrc}', to_jsonb('https://swzorezjlkovvgrcntrs.supabase.co/storage/v1/object/public/tsd-form-photos/template-pages/tpl-1784167638077/page-0.png'::text)) where id = 'tpl-1784167638077';
update tsd_form_templates set template = jsonb_set(template, '{imageSrc}', to_jsonb('https://swzorezjlkovvgrcntrs.supabase.co/storage/v1/object/public/tsd-form-photos/template-pages/tpl-1784167638077/page-0.png'::text)) where id = 'tpl-1784167638077';
update tsd_form_templates set template = jsonb_set(template, '{pages,1,imageSrc}', to_jsonb('https://swzorezjlkovvgrcntrs.supabase.co/storage/v1/object/public/tsd-form-photos/template-pages/tpl-1784167638077/page-1.png'::text)) where id = 'tpl-1784167638077';
update tsd_form_templates set template = jsonb_set(template, '{pages,2,imageSrc}', to_jsonb('https://swzorezjlkovvgrcntrs.supabase.co/storage/v1/object/public/tsd-form-photos/template-pages/tpl-1784167638077/page-2.png'::text)) where id = 'tpl-1784167638077';
update tsd_form_templates set template = jsonb_set(template, '{pages,3,imageSrc}', to_jsonb('https://swzorezjlkovvgrcntrs.supabase.co/storage/v1/object/public/tsd-form-photos/template-pages/tpl-1784167638077/page-3.png'::text)) where id = 'tpl-1784167638077';
update tsd_form_templates set template = jsonb_set(template, '{pages,4,imageSrc}', to_jsonb('https://swzorezjlkovvgrcntrs.supabase.co/storage/v1/object/public/tsd-form-photos/template-pages/tpl-1784167638077/page-4.png'::text)) where id = 'tpl-1784167638077';
update tsd_form_templates set template = jsonb_set(template, '{pages,5,imageSrc}', to_jsonb('https://swzorezjlkovvgrcntrs.supabase.co/storage/v1/object/public/tsd-form-photos/template-pages/tpl-1784167638077/page-5.png'::text)) where id = 'tpl-1784167638077';
update tsd_form_templates set template = jsonb_set(template, '{pages,6,imageSrc}', to_jsonb('https://swzorezjlkovvgrcntrs.supabase.co/storage/v1/object/public/tsd-form-photos/template-pages/tpl-1784167638077/page-6.png'::text)) where id = 'tpl-1784167638077';
update tsd_form_templates set updated_at = now() where id = 'tpl-1784167638077';
