-- Migration: Sistema de login e agenda para gestores
-- Criado: 2026-04-03

-- 1. Adiciona user_id na tabela gestores para vincular com auth.users
ALTER TABLE public.gestores 
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS password_hash TEXT; -- Opcional, para sistemas com auth própria

-- Índice para busca rápida por user_id
CREATE INDEX IF NOT EXISTS idx_gestores_user_id ON public.gestores(user_id);

-- 2. Cria tabela de bloqueios específicos por gestor
CREATE TABLE IF NOT EXISTS public.booking_blocked_slots_gestor (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gestor_id    UUID NOT NULL REFERENCES public.gestores(id) ON DELETE CASCADE,
  blocked_date DATE NOT NULL,
  blocked_time TEXT, -- NULL = dia inteiro, "09:00" = slot específico
  reason       TEXT,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);

-- Índices únicos para evitar duplicados
CREATE UNIQUE INDEX IF NOT EXISTS booking_blocked_slots_gestor_fullday
  ON public.booking_blocked_slots_gestor(gestor_id, blocked_date) WHERE blocked_time IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS booking_blocked_slots_gestor_timeslot
  ON public.booking_blocked_slots_gestor(gestor_id, blocked_date, blocked_time) WHERE blocked_time IS NOT NULL;

-- Índice para busca rápida
CREATE INDEX IF NOT EXISTS idx_booking_blocked_gestor_lookup 
  ON public.booking_blocked_slots_gestor(gestor_id, blocked_date);

-- 3. RLS Policies para gestores
ALTER TABLE public.gestores ENABLE ROW LEVEL SECURITY;

-- Gestores podem ver seus próprios dados
CREATE POLICY "gestores_own_data" ON public.gestores
  FOR SELECT USING (
    user_id = auth.uid() OR 
    EXISTS (
      SELECT 1 FROM public.profiles 
      WHERE id = auth.uid() AND role IN ('admin', 'moderador')
    )
  );

-- Apenas admin pode modificar gestores
CREATE POLICY "gestores_admin_modify" ON public.gestores
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.profiles 
      WHERE id = auth.uid() AND role IN ('admin', 'moderador')
    )
  );

-- 4. RLS Policies para bloqueios de agenda do gestor
ALTER TABLE public.booking_blocked_slots_gestor ENABLE ROW LEVEL SECURITY;

-- Gestor pode ver e modificar seus próprios bloqueios
CREATE POLICY "blocked_slots_gestor_own" ON public.booking_blocked_slots_gestor
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.gestores g
      WHERE g.id = booking_blocked_slots_gestor.gestor_id 
      AND g.user_id = auth.uid()
    )
  );

-- Admin pode ver e modificar todos os bloqueios de gestores
CREATE POLICY "blocked_slots_gestor_admin" ON public.booking_blocked_slots_gestor
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.profiles 
      WHERE id = auth.uid() AND role IN ('admin', 'moderador')
    )
  );

-- Clientes podem ver bloqueios do seu gestor (para saber disponibilidade)
CREATE POLICY "blocked_slots_gestor_client_read" ON public.booking_blocked_slots_gestor
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.clients c
      JOIN public.gestores g ON g.id = c.gestor_id
      WHERE c.profile_id = auth.uid()
      AND g.id = booking_blocked_slots_gestor.gestor_id
    )
  );

-- 5. Função para obter ID do gestor do usuário logado
CREATE OR REPLACE FUNCTION get_my_gestor_id()
RETURNS UUID AS $$
BEGIN
  RETURN (
    SELECT id FROM public.gestores 
    WHERE user_id = auth.uid() 
    LIMIT 1
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 6. Função para verificar se usuário é gestor
CREATE OR REPLACE FUNCTION is_gestor()
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.gestores 
    WHERE user_id = auth.uid() AND active = TRUE
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 7. Trigger para atualizar updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_booking_blocked_gestor_updated_at
  BEFORE UPDATE ON public.booking_blocked_slots_gestor
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- 8. Comentários para documentação
COMMENT ON TABLE public.booking_blocked_slots_gestor IS 'Bloqueios de agenda específicos por gestor. Gestores podem bloquear dias ou horários para evitar agendamentos de seus clientes.';
COMMENT ON COLUMN public.gestores.user_id IS 'Vínculo com auth.users para login do gestor';
COMMENT ON COLUMN public.booking_blocked_slots_gestor.blocked_time IS 'NULL = dia inteiro bloqueado, HH:MM = horário específico';
