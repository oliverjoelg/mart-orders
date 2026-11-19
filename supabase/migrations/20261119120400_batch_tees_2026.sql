-- The 2026 batch T-shirt round and its four products (from PRODUCT-BRIEF.md).
-- XXS is offered only for the Classic MDI colours. Other sizes typed into the form
-- (e.g. "Chest 38 / Length 28") are kept as custom sizes and flagged at import.

insert into public.campaigns (name) values ('Batch Tees 2026');

insert into public.products (campaign_id, name, colour, price_inr, sizes, form_keywords, sort_order)
select c.id, p.name, p.colour, p.price, p.sizes, p.keywords, p.sort_order
  from public.campaigns c
 cross join (values
   ('Classic MDI Navy Blue', 'Navy Blue', 699,
     array['XXS','XS','S','M','L','XL','XXL','XXXL'], array['navy','blue'], 1),
   ('Classic MDI Baby Pink', 'Baby Pink', 699,
     array['XXS','XS','S','M','L','XL','XXL','XXXL'], array['pink'], 2),
   ('Premium UCB Black', 'Black', 1049,
     array['XS','S','M','L','XL','XXL','XXXL'], array['black'], 3),
   ('Premium UCB White', 'White', 1049,
     array['XS','S','M','L','XL','XXL','XXXL'], array['white'], 4)
 ) as p(name, colour, price, sizes, keywords, sort_order)
 where c.name = 'Batch Tees 2026';
