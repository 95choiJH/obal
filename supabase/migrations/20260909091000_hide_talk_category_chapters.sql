update public.live_category_history
set hidden = true
where coalesce(hidden, false) = false
  and lower(coalesce(category_id, '')) = 'talk'
  and upper(coalesce(category_type, '')) = 'ETC';