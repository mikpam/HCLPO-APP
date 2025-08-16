-- Sample customer data insertion script
-- Use this to quickly add test customers to your database

INSERT INTO customers (customer_number, company_name, email, phone, alternate_names) VALUES
  ('C12345', 'ACME Corporation', 'orders@acme.com', '555-0123', ARRAY['ACME Corp', 'ACME Inc']),
  ('C23456', 'Global Solutions LLC', 'purchasing@global.com', '555-0234', ARRAY['Global Solutions', 'Global LLC']),
  ('C34567', 'TechnoMax Industries', 'orders@technomax.com', '555-0345', ARRAY['TechnoMax', 'Techno Max']),
  ('C45678', 'Creative Marketing Specialists', 'info@creative.com', '555-0456', ARRAY['Creative Marketing', 'CMS']),
  ('C56789', 'Oklahoma Promo LLC', 'sales@okpromo.com', '555-0567', ARRAY['Oklahoma Promo', 'OK Promo']),
  ('C67890', 'Mark It Promotions', 'orders@markit.com', '555-0678', ARRAY['Mark It', 'Mark-It Promotions']),
  ('C78901', 'Sunshine Enterprises', 'purchasing@sunshine.com', '555-0789', ARRAY['Sunshine Ent', 'Sunshine']),
  ('C89012', 'Metro Office Supply', 'orders@metro.com', '555-0890', ARRAY['Metro Supply', 'Metro Office']),
  ('C90123', 'Alpine Distribution', 'sales@alpine.com', '555-0901', ARRAY['Alpine Dist', 'Alpine']),
  ('C01234', 'Coastal Marketing Group', 'info@coastal.com', '555-0012', ARRAY['Coastal Marketing', 'CMG']);

-- For bulk testing, you can generate more records like this:
-- SELECT 
--   'C' || LPAD((generate_series(10000, 19999))::text, 5, '0') as customer_number,
--   'Test Company ' || generate_series(10000, 19999) as company_name,
--   'orders' || generate_series(10000, 19999) || '@test.com' as email,
--   '555-' || LPAD((generate_series(1000, 9999))::text, 4, '0') as phone,
--   ARRAY['Test Co ' || generate_series(10000, 19999)] as alternate_names;