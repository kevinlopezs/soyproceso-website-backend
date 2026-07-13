-- Los Planes Respiro ahora se recomiendan según el tamaño del equipo: el admin
-- registra el número de colaboradores de la empresa y el sistema deriva el plan
-- recomendado (esencial <=20, activo <=50, integral >50). El plan derivado se
-- guarda en recommended_plan, por lo que get_respiro_config sigue igual.
alter table public.client_reports
  add column if not exists collaborators_count integer
    check (collaborators_count is null or collaborators_count > 0);
