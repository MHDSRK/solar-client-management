CREATE OR REPLACE VIEW public.customer_financial_summary AS
SELECT
  c.id AS customer_id,
  c.customer_code,
  c.customer_name,
  c.contract_value,
  COALESCE((SELECT SUM(p.amount) FROM public.payments p WHERE p.customer_id = c.id AND p.status = 'confirmed'), 0) AS received,
  c.contract_value - COALESCE((SELECT SUM(p.amount) FROM public.payments p WHERE p.customer_id = c.id AND p.status = 'confirmed'), 0) AS balance_due,
  COALESCE((SELECT SUM(e.disun_cost + e.kseb + e.meter_cost + e.structure + e.material + e.electrical + e.paperwork)
    FROM public.expenses e WHERE e.customer_id = c.id AND e.status <> 'void'), 0) AS tracked_costs,
  COALESCE((SELECT SUM(e.disun_cost + e.kseb + e.meter_cost + e.structure + e.material + e.electrical + e.paperwork)
    FROM public.expenses e WHERE e.customer_id = c.id AND e.status = 'confirmed'), 0) AS actual_expenses,
  c.contract_value - COALESCE((SELECT SUM(e.disun_cost + e.kseb + e.meter_cost + e.structure + e.material + e.electrical + e.paperwork)
    FROM public.expenses e WHERE e.customer_id = c.id AND e.status = 'confirmed'), 0) AS project_profit_loss,
  COALESCE((SELECT SUM(p.amount) FROM public.payments p WHERE p.customer_id = c.id AND p.status = 'confirmed'), 0) - COALESCE((SELECT SUM(e.disun_cost + e.kseb + e.meter_cost + e.structure + e.material + e.electrical + e.paperwork)
    FROM public.expenses e WHERE e.customer_id = c.id AND e.status = 'confirmed'), 0) AS cash_position
FROM public.customers c;

CREATE OR REPLACE FUNCTION public.get_payment_status(p_received NUMERIC, p_contract_value NUMERIC)
RETURNS TEXT AS $$
BEGIN
  IF p_received = 0 THEN
    RETURN 'Unpaid';
  ELSIF p_received > 0 AND p_received < p_contract_value THEN
    RETURN 'Part-paid';
  ELSE
    RETURN 'Paid';
  END IF;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

CREATE OR REPLACE FUNCTION public.get_disun_cost(p_capacity_kw NUMERIC, p_rate NUMERIC)
RETURNS NUMERIC AS $$
BEGIN
  RETURN p_capacity_kw * p_rate;
END;
$$ LANGUAGE plpgsql IMMUTABLE;
