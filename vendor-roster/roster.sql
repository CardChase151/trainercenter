-- Vendor roster for one event. Set the id, run it, shape the result into
-- roster-data.json. See README.md.
--   10.25.2026 Pokemon Event: 8e97b61c-01eb-4fd2-8d3a-dd2cac8e81a1
select coalesce(v.business_name, v.name)          as name,
       nullif(replace(v.ig_handle, '@', ''), '')  as ig,
       v.email,
       v.phone,
       coalesce(v.specialty,
                initcap(replace(v.vendor_type, '_', ' '))) as kind,
       case
         when va.payment_status = 'charged'                    then 'in'
         when va.fee_cents = 0                                 then 'comped'
         when va.stripe_payment_method_id is null              then 'nocard'
         else 'waiting'
       end                                        as state,
       coalesce(va.charged_amount_cents, 0) / 100 as paid,
       -- Only card vendors count toward the thirty.
       coalesce(v.vendor_type, 'card_vendor') = 'card_vendor' as "table",
       coalesce(va.payment_note, '')              as note,
       va.status                                  as application_status,
       va.fee_cents / 100                         as quoted
  from vendor_applications va
  join vendors v on v.id = va.vendor_id
 where va.event_id = '8e97b61c-01eb-4fd2-8d3a-dd2cac8e81a1'
   and va.status not in ('declined', 'cancelled', 'not_interested', 'vendor_cancelled')
 order by (va.payment_status = 'charged') desc, name;
