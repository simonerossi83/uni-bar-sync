
CREATE TABLE public.menu_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  price numeric(6,2) NOT NULL,
  category text NOT NULL,
  available boolean NOT NULL DEFAULT true,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.menu_items TO anon, authenticated;
GRANT ALL ON public.menu_items TO service_role;
ALTER TABLE public.menu_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "menu readable by all" ON public.menu_items FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "menu updatable by all" ON public.menu_items FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);

CREATE SEQUENCE public.order_number_seq START 21;

CREATE TABLE public.orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_number int NOT NULL UNIQUE DEFAULT nextval('public.order_number_seq'),
  status text NOT NULL DEFAULT 'received',
  note text,
  total numeric(8,2) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT USAGE, SELECT ON SEQUENCE public.order_number_seq TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.orders TO anon, authenticated;
GRANT ALL ON public.orders TO service_role;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "orders readable by all" ON public.orders FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "orders insertable by all" ON public.orders FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "orders updatable by all" ON public.orders FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);

CREATE TABLE public.order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  menu_item_id uuid REFERENCES public.menu_items(id) ON DELETE SET NULL,
  name text NOT NULL,
  unit_price numeric(6,2) NOT NULL,
  quantity int NOT NULL CHECK (quantity > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.order_items TO anon, authenticated;
GRANT ALL ON public.order_items TO service_role;
ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "order items readable by all" ON public.order_items FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "order items insertable by all" ON public.order_items FOR INSERT TO anon, authenticated WITH CHECK (true);

CREATE INDEX orders_status_idx ON public.orders(status);
CREATE INDEX order_items_order_id_idx ON public.order_items(order_id);

CREATE OR REPLACE FUNCTION public.touch_updated_at() RETURNS trigger AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$ LANGUAGE plpgsql SET search_path = public;
CREATE TRIGGER orders_touch BEFORE UPDATE ON public.orders FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

ALTER TABLE public.orders REPLICA IDENTITY FULL;
ALTER TABLE public.order_items REPLICA IDENTITY FULL;
ALTER TABLE public.menu_items REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.orders;
ALTER PUBLICATION supabase_realtime ADD TABLE public.order_items;
ALTER PUBLICATION supabase_realtime ADD TABLE public.menu_items;

INSERT INTO public.menu_items (name, description, price, category, sort_order) VALUES
('Espresso','Miscela arabica, tazza piccola',1.10,'Caffetteria',1),
('Cappuccino','Espresso e latte montato',1.50,'Caffetteria',2),
('Caffè americano','Espresso lungo in tazza grande',1.30,'Caffetteria',3),
('Latte macchiato','Latte caldo con un shot di espresso',1.60,'Caffetteria',4),
('Orzo','Bevanda al malto d''orzo, senza caffeina',1.20,'Caffetteria',5),
('Acqua naturale 50cl','Bottiglia di acqua minerale',0.80,'Bevande',1),
('Coca-Cola 33cl','Lattina fredda',2.00,'Bevande',2),
('Tè freddo al limone','Lattina 33cl ghiacciata',1.80,'Bevande',3),
('Succo ACE','Bottiglietta di succo arancia-carota-limone',1.70,'Bevande',4),
('Panino prosciutto e formaggio','Rosetta con cotto e emmental',3.50,'Panini',1),
('Panino vegetariano','Grigliata di verdure e hummus',3.80,'Panini',2),
('Toast','Prosciutto cotto e formaggio, servito caldo',2.80,'Panini',3),
('Piadina crudo e rucola','Piadina romagnola con crudo, rucola e squacquerone',4.50,'Panini',4),
('Patatine classiche','Busta 50g',1.50,'Snack',1),
('Taralli','Sacchetto di taralli pugliesi',1.60,'Snack',2),
('Barretta ai cereali','Snack ai cereali e cioccolato',1.30,'Snack',3),
('Frutta fresca','Porzione di frutta di stagione',1.40,'Snack',4),
('Cornetto vuoto','Sfogliato appena scaldato',1.20,'Dolci',1),
('Cornetto alla crema','Sfogliato con crema pasticcera',1.40,'Dolci',2),
('Muffin al cioccolato','Muffin soffice con gocce di cioccolato',1.80,'Dolci',3),
('Ciambella glassata','Donut con glassa allo zucchero',1.70,'Dolci',4);
