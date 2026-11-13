-- SAHM live-schema baseline snapshot (PostgreSQL 17 / Supabase)
-- Captured from project nusjnnrtpxbpphphmdsc on 2026-11-13.
-- Fresh-project bootstrap snapshot, not an incremental migration.
-- Do not run on a populated project: it creates the current schema and objects.
-- The live project was initially bootstrapped directly through SQL MCP.
-- Supabase-managed event triggers are intentionally excluded; only ensure_rls is custom.
-- Review and run only against a new, empty Supabase project.
-- The browser uses only a publishable key; never add service_role or other secrets here.

CREATE SCHEMA IF NOT EXISTS private; CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions; REVOKE ALL ON SCHEMA private FROM PUBLIC,anon,authenticated; GRANT USAGE ON SCHEMA private TO authenticated; GRANT USAGE ON SCHEMA public TO authenticated;

CREATE TABLE public.association_cycles (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  association_id uuid NOT NULL,
  cycle_no integer NOT NULL,
  starts_on date NOT NULL,
  ends_on date NOT NULL,
  duration_days integer NOT NULL,
  currency text NOT NULL,
  share_amount_minor bigint NOT NULL,
  installments_count integer NOT NULL,
  cycle_type text NOT NULL,
  status text DEFAULT 'scheduled'::text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.association_events (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  association_id uuid NOT NULL,
  actor_user_id uuid,
  event_type text NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid,
  visibility text DEFAULT 'manager'::text NOT NULL,
  before_data jsonb,
  after_data jsonb,
  occurred_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.association_memberships (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  association_id uuid NOT NULL,
  user_id uuid NOT NULL,
  joined_at timestamp with time zone DEFAULT now() NOT NULL,
  status text DEFAULT 'active'::text NOT NULL,
  left_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.association_notification_settings (
  association_id uuid NOT NULL,
  enabled_types text[] DEFAULT ARRAY['received'::text, 'completed'::text, 'late'::text, 'drawSoon'::text, 'drawDue'::text, 'drawResult'::text, 'joined'::text, 'motivate'::text] NOT NULL,
  updated_by_user_id uuid,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.association_user_preferences (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  association_id uuid NOT NULL,
  user_id uuid NOT NULL,
  mute_group boolean DEFAULT false NOT NULL,
  mute_reminders boolean DEFAULT false NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.associations (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  manager_user_id uuid NOT NULL,
  name text NOT NULL,
  currency text NOT NULL,
  start_date date NOT NULL,
  invite_opens_on date,
  invite_closes_on date,
  time_zone text NOT NULL,
  cycle_type text NOT NULL,
  cycle_days integer NOT NULL,
  share_amount_minor bigint NOT NULL,
  installments_count integer NOT NULL,
  target_shares integer NOT NULL,
  max_shares_per_member integer NOT NULL,
  manager_participates boolean DEFAULT false NOT NULL,
  quorum_percent integer DEFAULT 66 NOT NULL,
  rules text DEFAULT ''::text NOT NULL,
  locked_at timestamp with time zone,
  locked_share_count integer,
  status text DEFAULT 'active'::text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.chat_messages (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  association_id uuid NOT NULL,
  sender_user_id uuid,
  kind text NOT NULL,
  body text NOT NULL,
  system_type text,
  event_id uuid,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.chat_read_states (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  association_id uuid NOT NULL,
  user_id uuid NOT NULL,
  last_read_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.cycle_attendance (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  association_id uuid NOT NULL,
  cycle_id uuid NOT NULL,
  membership_id uuid NOT NULL,
  present boolean NOT NULL,
  marked_by_user_id uuid NOT NULL,
  marked_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.draw_eligible_shares (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  association_id uuid NOT NULL,
  draw_id uuid NOT NULL,
  share_id uuid NOT NULL,
  captured_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.draws (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  association_id uuid NOT NULL,
  cycle_id uuid NOT NULL,
  round_no integer NOT NULL,
  scheduled_on date NOT NULL,
  drawn_at timestamp with time zone DEFAULT now() NOT NULL,
  winner_share_id uuid NOT NULL,
  share_count_at_draw integer NOT NULL,
  eligible_count integer NOT NULL,
  prize_target_minor bigint NOT NULL,
  quorum_people integer NOT NULL,
  quorum_required integer NOT NULL,
  algorithm_version text NOT NULL
);

CREATE TABLE public.installment_obligations (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  association_id uuid NOT NULL,
  cycle_id uuid NOT NULL,
  membership_id uuid NOT NULL,
  period_id uuid NOT NULL,
  shares_count integer NOT NULL,
  amount_minor bigint NOT NULL,
  currency text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.installment_periods (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  association_id uuid NOT NULL,
  cycle_id uuid NOT NULL,
  installment_no integer NOT NULL,
  starts_on date NOT NULL,
  ends_on date NOT NULL,
  per_share_amount_minor bigint NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.installment_receipts (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  association_id uuid NOT NULL,
  obligation_id uuid NOT NULL,
  membership_id uuid NOT NULL,
  beneficiary_user_id uuid NOT NULL,
  recorded_by_user_id uuid NOT NULL,
  amount_minor bigint NOT NULL,
  currency text NOT NULL,
  recorded_at timestamp with time zone DEFAULT now() NOT NULL,
  self_recorded boolean DEFAULT false NOT NULL,
  status text DEFAULT 'active'::text NOT NULL
);

CREATE TABLE public.invitations (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  association_id uuid NOT NULL,
  created_by uuid NOT NULL,
  invitee_name text NOT NULL,
  invitee_phone_e164 text,
  shares_requested integer NOT NULL,
  token_hash text NOT NULL,
  status text DEFAULT 'pending'::text NOT NULL,
  invited_user_id uuid,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  expires_at timestamp with time zone,
  accepted_at timestamp with time zone,
  cancelled_at timestamp with time zone
);

CREATE TABLE public.notifications (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  association_id uuid,
  type text NOT NULL,
  title text NOT NULL,
  body text NOT NULL,
  related_entity_id uuid,
  idempotency_key text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  read_at timestamp with time zone
);

CREATE TABLE public.profile_private (
  user_id uuid NOT NULL,
  phone_e164 text NOT NULL,
  city text,
  phone_verified_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.profiles (
  id uuid NOT NULL,
  full_name text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.receipt_corrections (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  association_id uuid NOT NULL,
  receipt_id uuid NOT NULL,
  corrected_by_user_id uuid NOT NULL,
  reason text NOT NULL,
  action text NOT NULL,
  before_snapshot jsonb NOT NULL,
  after_snapshot jsonb NOT NULL,
  corrected_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.reminders (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  association_id uuid NOT NULL,
  obligation_id uuid NOT NULL,
  recipient_user_id uuid NOT NULL,
  sent_by_user_id uuid NOT NULL,
  batch_id uuid,
  sent_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.shares (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  association_id uuid NOT NULL,
  membership_id uuid NOT NULL,
  share_no integer NOT NULL,
  status text DEFAULT 'active'::text NOT NULL,
  added_at timestamp with time zone DEFAULT now() NOT NULL,
  removed_at timestamp with time zone
);

CREATE TABLE public.user_preferences (
  user_id uuid NOT NULL,
  notifications_enabled boolean DEFAULT true NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE public.association_cycles ADD CONSTRAINT association_cycles_installments_count_check CHECK (installments_count > 0);

ALTER TABLE public.association_cycles ADD CONSTRAINT association_cycles_association_id_fkey FOREIGN KEY (association_id) REFERENCES associations(id) ON DELETE RESTRICT;

ALTER TABLE public.association_cycles ADD CONSTRAINT association_cycles_id_association_id_key UNIQUE (id, association_id);

ALTER TABLE public.association_cycles ADD CONSTRAINT association_cycles_association_id_cycle_no_key UNIQUE (association_id, cycle_no);

ALTER TABLE public.association_cycles ADD CONSTRAINT association_cycles_pkey PRIMARY KEY (id);

ALTER TABLE public.association_cycles ADD CONSTRAINT association_cycles_check1 CHECK ((ends_on - starts_on + 1) = duration_days);

ALTER TABLE public.association_cycles ADD CONSTRAINT association_cycles_check CHECK (ends_on >= starts_on);

ALTER TABLE public.association_cycles ADD CONSTRAINT association_cycles_status_check CHECK (status = ANY (ARRAY['scheduled'::text, 'open'::text, 'drawn'::text, 'completed'::text]));

ALTER TABLE public.association_cycles ADD CONSTRAINT association_cycles_cycle_no_check CHECK (cycle_no > 0);

ALTER TABLE public.association_cycles ADD CONSTRAINT association_cycles_duration_days_check CHECK (duration_days > 0);

ALTER TABLE public.association_cycles ADD CONSTRAINT association_cycles_currency_check CHECK (currency = ANY (ARRAY['YER'::text, 'SAR'::text, 'USD'::text]));

ALTER TABLE public.association_cycles ADD CONSTRAINT association_cycles_share_amount_minor_check CHECK (share_amount_minor > 0);

ALTER TABLE public.association_cycles ADD CONSTRAINT association_cycles_cycle_type_check CHECK (cycle_type = ANY (ARRAY['weekly'::text, 'monthly'::text, 'custom'::text]));

ALTER TABLE public.association_events ADD CONSTRAINT association_events_association_id_fkey FOREIGN KEY (association_id) REFERENCES associations(id) ON DELETE RESTRICT;

ALTER TABLE public.association_events ADD CONSTRAINT association_events_actor_user_id_fkey FOREIGN KEY (actor_user_id) REFERENCES profiles(id) ON DELETE RESTRICT;

ALTER TABLE public.association_events ADD CONSTRAINT association_events_visibility_check CHECK (visibility = ANY (ARRAY['manager'::text, 'member'::text, 'all'::text]));

ALTER TABLE public.association_events ADD CONSTRAINT association_events_pkey PRIMARY KEY (id);

ALTER TABLE public.association_events ADD CONSTRAINT association_events_id_association_id_key UNIQUE (id, association_id);

ALTER TABLE public.association_memberships ADD CONSTRAINT association_memberships_id_association_id_user_id_key UNIQUE (id, association_id, user_id);

ALTER TABLE public.association_memberships ADD CONSTRAINT association_memberships_user_id_fkey FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE RESTRICT;

ALTER TABLE public.association_memberships ADD CONSTRAINT association_memberships_status_check CHECK (status = ANY (ARRAY['active'::text, 'left'::text]));

ALTER TABLE public.association_memberships ADD CONSTRAINT association_memberships_check CHECK (status = 'active'::text AND left_at IS NULL OR status = 'left'::text AND left_at IS NOT NULL);

ALTER TABLE public.association_memberships ADD CONSTRAINT association_memberships_pkey PRIMARY KEY (id);

ALTER TABLE public.association_memberships ADD CONSTRAINT association_memberships_association_id_user_id_key UNIQUE (association_id, user_id);

ALTER TABLE public.association_memberships ADD CONSTRAINT association_memberships_id_association_id_key UNIQUE (id, association_id);

ALTER TABLE public.association_memberships ADD CONSTRAINT association_memberships_association_id_fkey FOREIGN KEY (association_id) REFERENCES associations(id) ON DELETE RESTRICT;

ALTER TABLE public.association_notification_settings ADD CONSTRAINT association_notification_settings_pkey PRIMARY KEY (association_id);

ALTER TABLE public.association_notification_settings ADD CONSTRAINT association_notification_settings_updated_by_user_id_fkey FOREIGN KEY (updated_by_user_id) REFERENCES profiles(id) ON DELETE RESTRICT;

ALTER TABLE public.association_notification_settings ADD CONSTRAINT association_notification_settings_association_id_fkey FOREIGN KEY (association_id) REFERENCES associations(id) ON DELETE RESTRICT;

ALTER TABLE public.association_user_preferences ADD CONSTRAINT association_user_preferences_pkey PRIMARY KEY (id);

ALTER TABLE public.association_user_preferences ADD CONSTRAINT association_user_preferences_association_id_user_id_key UNIQUE (association_id, user_id);

ALTER TABLE public.association_user_preferences ADD CONSTRAINT association_user_preferences_user_id_fkey FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE RESTRICT;

ALTER TABLE public.association_user_preferences ADD CONSTRAINT association_user_preferences_association_id_fkey FOREIGN KEY (association_id) REFERENCES associations(id) ON DELETE RESTRICT;

ALTER TABLE public.associations ADD CONSTRAINT associations_cycle_days_check CHECK (cycle_days > 0);

ALTER TABLE public.associations ADD CONSTRAINT associations_check CHECK (installments_count > 0 AND installments_count <= cycle_days);

ALTER TABLE public.associations ADD CONSTRAINT associations_target_shares_check CHECK (target_shares > 0);

ALTER TABLE public.associations ADD CONSTRAINT associations_check1 CHECK (max_shares_per_member > 0 AND max_shares_per_member <= target_shares);

ALTER TABLE public.associations ADD CONSTRAINT associations_quorum_percent_check CHECK (quorum_percent >= 1 AND quorum_percent <= 100);

ALTER TABLE public.associations ADD CONSTRAINT associations_locked_share_count_check CHECK (locked_share_count IS NULL OR locked_share_count > 0);

ALTER TABLE public.associations ADD CONSTRAINT associations_status_check CHECK (status = ANY (ARRAY['active'::text, 'closed'::text]));

ALTER TABLE public.associations ADD CONSTRAINT associations_check2 CHECK (cycle_type = 'weekly'::text AND cycle_days = 7 OR cycle_type = 'monthly'::text AND cycle_days = 30 OR cycle_type = 'custom'::text AND cycle_days >= 1 AND cycle_days <= 3650);

ALTER TABLE public.associations ADD CONSTRAINT associations_check3 CHECK (invite_opens_on IS NULL OR invite_closes_on IS NULL OR invite_opens_on <= invite_closes_on);

ALTER TABLE public.associations ADD CONSTRAINT associations_check4 CHECK (locked_at IS NULL AND locked_share_count IS NULL OR locked_at IS NOT NULL AND locked_share_count IS NOT NULL);

ALTER TABLE public.associations ADD CONSTRAINT associations_pkey PRIMARY KEY (id);

ALTER TABLE public.associations ADD CONSTRAINT associations_id_manager_user_id_key UNIQUE (id, manager_user_id);

ALTER TABLE public.associations ADD CONSTRAINT associations_manager_user_id_fkey FOREIGN KEY (manager_user_id) REFERENCES profiles(id) ON DELETE RESTRICT;

ALTER TABLE public.associations ADD CONSTRAINT associations_name_check CHECK (length(btrim(name)) >= 2 AND length(btrim(name)) <= 120);

ALTER TABLE public.associations ADD CONSTRAINT associations_currency_check CHECK (currency = ANY (ARRAY['YER'::text, 'SAR'::text, 'USD'::text]));

ALTER TABLE public.associations ADD CONSTRAINT associations_cycle_type_check CHECK (cycle_type = ANY (ARRAY['weekly'::text, 'monthly'::text, 'custom'::text]));

ALTER TABLE public.associations ADD CONSTRAINT associations_share_amount_minor_check CHECK (share_amount_minor > 0);

ALTER TABLE public.chat_messages ADD CONSTRAINT chat_messages_sender_user_id_fkey FOREIGN KEY (sender_user_id) REFERENCES profiles(id) ON DELETE RESTRICT;

ALTER TABLE public.chat_messages ADD CONSTRAINT chat_messages_event_id_association_id_fkey FOREIGN KEY (event_id, association_id) REFERENCES association_events(id, association_id) ON DELETE RESTRICT;

ALTER TABLE public.chat_messages ADD CONSTRAINT chat_messages_kind_check CHECK (kind = ANY (ARRAY['member'::text, 'system'::text]));

ALTER TABLE public.chat_messages ADD CONSTRAINT chat_messages_check CHECK (kind = 'member'::text AND sender_user_id IS NOT NULL AND system_type IS NULL AND char_length(body) >= 1 AND char_length(body) <= 50 OR kind = 'system'::text AND sender_user_id IS NULL AND system_type IS NOT NULL AND char_length(body) > 0);

ALTER TABLE public.chat_messages ADD CONSTRAINT chat_messages_pkey PRIMARY KEY (id);

ALTER TABLE public.chat_messages ADD CONSTRAINT chat_messages_association_id_fkey FOREIGN KEY (association_id) REFERENCES associations(id) ON DELETE RESTRICT;

ALTER TABLE public.chat_read_states ADD CONSTRAINT chat_read_states_pkey PRIMARY KEY (id);

ALTER TABLE public.chat_read_states ADD CONSTRAINT chat_read_states_association_id_user_id_key UNIQUE (association_id, user_id);

ALTER TABLE public.chat_read_states ADD CONSTRAINT chat_read_states_user_id_fkey FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE RESTRICT;

ALTER TABLE public.chat_read_states ADD CONSTRAINT chat_read_states_association_id_fkey FOREIGN KEY (association_id) REFERENCES associations(id) ON DELETE RESTRICT;

ALTER TABLE public.cycle_attendance ADD CONSTRAINT cycle_attendance_cycle_id_membership_id_key UNIQUE (cycle_id, membership_id);

ALTER TABLE public.cycle_attendance ADD CONSTRAINT cycle_attendance_pkey PRIMARY KEY (id);

ALTER TABLE public.cycle_attendance ADD CONSTRAINT cycle_attendance_marked_by_user_id_fkey FOREIGN KEY (marked_by_user_id) REFERENCES profiles(id) ON DELETE RESTRICT;

ALTER TABLE public.cycle_attendance ADD CONSTRAINT cycle_attendance_cycle_id_association_id_fkey FOREIGN KEY (cycle_id, association_id) REFERENCES association_cycles(id, association_id) ON DELETE RESTRICT;

ALTER TABLE public.cycle_attendance ADD CONSTRAINT cycle_attendance_membership_id_association_id_fkey FOREIGN KEY (membership_id, association_id) REFERENCES association_memberships(id, association_id) ON DELETE RESTRICT;

ALTER TABLE public.draw_eligible_shares ADD CONSTRAINT draw_eligible_shares_pkey PRIMARY KEY (id);

ALTER TABLE public.draw_eligible_shares ADD CONSTRAINT draw_eligible_shares_draw_id_share_id_key UNIQUE (draw_id, share_id);

ALTER TABLE public.draw_eligible_shares ADD CONSTRAINT draw_eligible_shares_draw_id_association_id_fkey FOREIGN KEY (draw_id, association_id) REFERENCES draws(id, association_id) ON DELETE RESTRICT;

ALTER TABLE public.draw_eligible_shares ADD CONSTRAINT draw_eligible_shares_share_id_association_id_fkey FOREIGN KEY (share_id, association_id) REFERENCES shares(id, association_id) ON DELETE RESTRICT;

ALTER TABLE public.draws ADD CONSTRAINT draws_winner_share_id_association_id_fkey FOREIGN KEY (winner_share_id, association_id) REFERENCES shares(id, association_id) ON DELETE RESTRICT;

ALTER TABLE public.draws ADD CONSTRAINT draws_share_count_at_draw_check CHECK (share_count_at_draw > 0);

ALTER TABLE public.draws ADD CONSTRAINT draws_quorum_required_check CHECK (quorum_required >= 0);

ALTER TABLE public.draws ADD CONSTRAINT draws_pkey PRIMARY KEY (id);

ALTER TABLE public.draws ADD CONSTRAINT draws_cycle_id_key UNIQUE (cycle_id);

ALTER TABLE public.draws ADD CONSTRAINT draws_quorum_people_check CHECK (quorum_people >= 0);

ALTER TABLE public.draws ADD CONSTRAINT draws_prize_target_minor_check CHECK (prize_target_minor > 0);

ALTER TABLE public.draws ADD CONSTRAINT draws_eligible_count_check CHECK (eligible_count > 0);

ALTER TABLE public.draws ADD CONSTRAINT draws_round_no_check CHECK (round_no > 0);

ALTER TABLE public.draws ADD CONSTRAINT draws_association_id_round_no_key UNIQUE (association_id, round_no);

ALTER TABLE public.draws ADD CONSTRAINT draws_id_association_id_key UNIQUE (id, association_id);

ALTER TABLE public.draws ADD CONSTRAINT draws_cycle_id_association_id_fkey FOREIGN KEY (cycle_id, association_id) REFERENCES association_cycles(id, association_id) ON DELETE RESTRICT;

ALTER TABLE public.installment_obligations ADD CONSTRAINT installment_obligations_membership_id_association_id_fkey FOREIGN KEY (membership_id, association_id) REFERENCES association_memberships(id, association_id) ON DELETE RESTRICT;

ALTER TABLE public.installment_obligations ADD CONSTRAINT installment_obligations_id_association_id_key UNIQUE (id, association_id);

ALTER TABLE public.installment_obligations ADD CONSTRAINT installment_obligations_membership_id_period_id_key UNIQUE (membership_id, period_id);

ALTER TABLE public.installment_obligations ADD CONSTRAINT installment_obligations_pkey PRIMARY KEY (id);

ALTER TABLE public.installment_obligations ADD CONSTRAINT installment_obligations_shares_count_check CHECK (shares_count > 0);

ALTER TABLE public.installment_obligations ADD CONSTRAINT installment_obligations_amount_minor_check CHECK (amount_minor > 0);

ALTER TABLE public.installment_obligations ADD CONSTRAINT installment_obligations_period_id_cycle_id_association_id_fkey FOREIGN KEY (period_id, cycle_id, association_id) REFERENCES installment_periods(id, cycle_id, association_id) ON DELETE RESTRICT;

ALTER TABLE public.installment_obligations ADD CONSTRAINT installment_obligations_currency_check CHECK (currency = ANY (ARRAY['YER'::text, 'SAR'::text, 'USD'::text]));

ALTER TABLE public.installment_obligations ADD CONSTRAINT installment_obligations_id_association_id_membership_id_key UNIQUE (id, association_id, membership_id);

ALTER TABLE public.installment_obligations ADD CONSTRAINT installment_obligations_cycle_id_association_id_fkey FOREIGN KEY (cycle_id, association_id) REFERENCES association_cycles(id, association_id) ON DELETE RESTRICT;

ALTER TABLE public.installment_periods ADD CONSTRAINT installment_periods_per_share_amount_minor_check CHECK (per_share_amount_minor > 0);

ALTER TABLE public.installment_periods ADD CONSTRAINT installment_periods_installment_no_check CHECK (installment_no > 0);

ALTER TABLE public.installment_periods ADD CONSTRAINT installment_periods_cycle_id_association_id_fkey FOREIGN KEY (cycle_id, association_id) REFERENCES association_cycles(id, association_id) ON DELETE RESTRICT;

ALTER TABLE public.installment_periods ADD CONSTRAINT installment_periods_id_cycle_id_association_id_key UNIQUE (id, cycle_id, association_id);

ALTER TABLE public.installment_periods ADD CONSTRAINT installment_periods_cycle_id_installment_no_key UNIQUE (cycle_id, installment_no);

ALTER TABLE public.installment_periods ADD CONSTRAINT installment_periods_pkey PRIMARY KEY (id);

ALTER TABLE public.installment_periods ADD CONSTRAINT installment_periods_check CHECK (ends_on >= starts_on);

ALTER TABLE public.installment_receipts ADD CONSTRAINT installment_receipts_obligation_id_association_id_membersh_fkey FOREIGN KEY (obligation_id, association_id, membership_id) REFERENCES installment_obligations(id, association_id, membership_id) ON DELETE RESTRICT;

ALTER TABLE public.installment_receipts ADD CONSTRAINT installment_receipts_amount_minor_check CHECK (amount_minor > 0);

ALTER TABLE public.installment_receipts ADD CONSTRAINT installment_receipts_currency_check CHECK (currency = ANY (ARRAY['YER'::text, 'SAR'::text, 'USD'::text]));

ALTER TABLE public.installment_receipts ADD CONSTRAINT installment_receipts_status_check CHECK (status = ANY (ARRAY['active'::text, 'voided'::text]));

ALTER TABLE public.installment_receipts ADD CONSTRAINT installment_receipts_check CHECK (self_recorded = (recorded_by_user_id = beneficiary_user_id));

ALTER TABLE public.installment_receipts ADD CONSTRAINT installment_receipts_pkey PRIMARY KEY (id);

ALTER TABLE public.installment_receipts ADD CONSTRAINT installment_receipts_id_association_id_key UNIQUE (id, association_id);

ALTER TABLE public.installment_receipts ADD CONSTRAINT installment_receipts_recorded_by_user_id_fkey FOREIGN KEY (recorded_by_user_id) REFERENCES profiles(id) ON DELETE RESTRICT;

ALTER TABLE public.installment_receipts ADD CONSTRAINT installment_receipts_membership_id_association_id_benefici_fkey FOREIGN KEY (membership_id, association_id, beneficiary_user_id) REFERENCES association_memberships(id, association_id, user_id) ON DELETE RESTRICT;

ALTER TABLE public.invitations ADD CONSTRAINT invitations_invited_user_id_fkey FOREIGN KEY (invited_user_id) REFERENCES profiles(id) ON DELETE RESTRICT;

ALTER TABLE public.invitations ADD CONSTRAINT invitations_created_by_fkey FOREIGN KEY (created_by) REFERENCES profiles(id) ON DELETE RESTRICT;

ALTER TABLE public.invitations ADD CONSTRAINT invitations_invitee_phone_e164_check CHECK (invitee_phone_e164 IS NULL OR invitee_phone_e164 ~ '^[+][1-9][0-9]{7,14}$'::text);

ALTER TABLE public.invitations ADD CONSTRAINT invitations_status_check CHECK (status = ANY (ARRAY['pending'::text, 'accepted'::text, 'cancelled'::text, 'expired'::text]));

ALTER TABLE public.invitations ADD CONSTRAINT invitations_token_hash_key UNIQUE (token_hash);

ALTER TABLE public.invitations ADD CONSTRAINT invitations_association_id_fkey FOREIGN KEY (association_id) REFERENCES associations(id) ON DELETE RESTRICT;

ALTER TABLE public.invitations ADD CONSTRAINT invitations_pkey PRIMARY KEY (id);

ALTER TABLE public.invitations ADD CONSTRAINT invitations_shares_requested_check CHECK (shares_requested > 0);

ALTER TABLE public.notifications ADD CONSTRAINT notifications_pkey PRIMARY KEY (id);

ALTER TABLE public.notifications ADD CONSTRAINT notifications_association_id_fkey FOREIGN KEY (association_id) REFERENCES associations(id) ON DELETE RESTRICT;

ALTER TABLE public.notifications ADD CONSTRAINT notifications_user_id_fkey FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE RESTRICT;

ALTER TABLE public.notifications ADD CONSTRAINT notifications_idempotency_key_key UNIQUE (idempotency_key);

ALTER TABLE public.profile_private ADD CONSTRAINT profile_private_phone_e164_key UNIQUE (phone_e164);

ALTER TABLE public.profile_private ADD CONSTRAINT profile_private_phone_e164_check CHECK (phone_e164 ~ '^[+][1-9][0-9]{7,14}$'::text);

ALTER TABLE public.profile_private ADD CONSTRAINT profile_private_user_id_fkey FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE RESTRICT;

ALTER TABLE public.profile_private ADD CONSTRAINT profile_private_pkey PRIMARY KEY (user_id);

ALTER TABLE public.profiles ADD CONSTRAINT profiles_full_name_check CHECK (length(btrim(full_name)) >= 2 AND length(btrim(full_name)) <= 120);

ALTER TABLE public.profiles ADD CONSTRAINT profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE public.profiles ADD CONSTRAINT profiles_pkey PRIMARY KEY (id);

ALTER TABLE public.receipt_corrections ADD CONSTRAINT receipt_corrections_corrected_by_user_id_fkey FOREIGN KEY (corrected_by_user_id) REFERENCES profiles(id) ON DELETE RESTRICT;

ALTER TABLE public.receipt_corrections ADD CONSTRAINT receipt_corrections_receipt_id_association_id_fkey FOREIGN KEY (receipt_id, association_id) REFERENCES installment_receipts(id, association_id) ON DELETE RESTRICT;

ALTER TABLE public.receipt_corrections ADD CONSTRAINT receipt_corrections_pkey PRIMARY KEY (id);

ALTER TABLE public.receipt_corrections ADD CONSTRAINT receipt_corrections_action_check CHECK (action = 'void'::text);

ALTER TABLE public.receipt_corrections ADD CONSTRAINT receipt_corrections_reason_check CHECK (length(btrim(reason)) >= 3);

ALTER TABLE public.reminders ADD CONSTRAINT reminders_sent_by_user_id_fkey FOREIGN KEY (sent_by_user_id) REFERENCES profiles(id) ON DELETE RESTRICT;

ALTER TABLE public.reminders ADD CONSTRAINT reminders_obligation_id_association_id_fkey FOREIGN KEY (obligation_id, association_id) REFERENCES installment_obligations(id, association_id) ON DELETE RESTRICT;

ALTER TABLE public.reminders ADD CONSTRAINT reminders_pkey PRIMARY KEY (id);

ALTER TABLE public.reminders ADD CONSTRAINT reminders_recipient_user_id_fkey FOREIGN KEY (recipient_user_id) REFERENCES profiles(id) ON DELETE RESTRICT;

ALTER TABLE public.shares ADD CONSTRAINT shares_association_id_share_no_key UNIQUE (association_id, share_no);

ALTER TABLE public.shares ADD CONSTRAINT shares_share_no_check CHECK (share_no > 0);

ALTER TABLE public.shares ADD CONSTRAINT shares_membership_id_association_id_fkey FOREIGN KEY (membership_id, association_id) REFERENCES association_memberships(id, association_id) ON DELETE RESTRICT;

ALTER TABLE public.shares ADD CONSTRAINT shares_association_id_fkey FOREIGN KEY (association_id) REFERENCES associations(id) ON DELETE RESTRICT;

ALTER TABLE public.shares ADD CONSTRAINT shares_id_association_id_key UNIQUE (id, association_id);

ALTER TABLE public.shares ADD CONSTRAINT shares_status_check CHECK (status = ANY (ARRAY['active'::text, 'removed'::text]));

ALTER TABLE public.shares ADD CONSTRAINT shares_check CHECK (status = 'active'::text AND removed_at IS NULL OR status = 'removed'::text AND removed_at IS NOT NULL);

ALTER TABLE public.shares ADD CONSTRAINT shares_pkey PRIMARY KEY (id);

ALTER TABLE public.user_preferences ADD CONSTRAINT user_preferences_pkey PRIMARY KEY (user_id);

ALTER TABLE public.user_preferences ADD CONSTRAINT user_preferences_user_id_fkey FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE RESTRICT;

CREATE INDEX cycles_association_no_idx ON public.association_cycles USING btree (association_id, cycle_no);

CREATE INDEX association_events_actor_idx ON public.association_events USING btree (actor_user_id);

CREATE INDEX events_association_time_idx ON public.association_events USING btree (association_id, occurred_at DESC);

CREATE INDEX memberships_user_status_idx ON public.association_memberships USING btree (user_id, status, association_id);

CREATE INDEX association_notification_settings_updater_idx ON public.association_notification_settings USING btree (updated_by_user_id);

CREATE INDEX association_user_preferences_user_idx ON public.association_user_preferences USING btree (user_id);

CREATE INDEX associations_manager_status_idx ON public.associations USING btree (manager_user_id, status);

CREATE INDEX chat_messages_association_time_idx ON public.chat_messages USING btree (association_id, created_at DESC);

CREATE INDEX chat_messages_event_association_idx ON public.chat_messages USING btree (event_id, association_id);

CREATE INDEX chat_messages_sender_idx ON public.chat_messages USING btree (sender_user_id);

CREATE INDEX chat_read_states_user_idx ON public.chat_read_states USING btree (user_id);

CREATE INDEX attendance_cycle_idx ON public.cycle_attendance USING btree (association_id, cycle_id);

CREATE INDEX cycle_attendance_cycle_association_idx ON public.cycle_attendance USING btree (cycle_id, association_id);

CREATE INDEX cycle_attendance_marker_idx ON public.cycle_attendance USING btree (marked_by_user_id);

CREATE INDEX cycle_attendance_membership_association_idx ON public.cycle_attendance USING btree (membership_id, association_id);

CREATE INDEX draw_eligible_draw_association_idx ON public.draw_eligible_shares USING btree (draw_id, association_id);

CREATE INDEX draw_eligible_draw_idx ON public.draw_eligible_shares USING btree (draw_id);

CREATE INDEX draw_eligible_share_association_idx ON public.draw_eligible_shares USING btree (share_id, association_id);

CREATE INDEX draws_association_round_idx ON public.draws USING btree (association_id, round_no);

CREATE INDEX draws_cycle_association_idx ON public.draws USING btree (cycle_id, association_id);

CREATE UNIQUE INDEX draws_share_wins_once ON public.draws USING btree (winner_share_id);

CREATE INDEX draws_winner_association_idx ON public.draws USING btree (winner_share_id, association_id);

CREATE INDEX obligations_association_cycle_member_idx ON public.installment_obligations USING btree (association_id, cycle_id, membership_id);

CREATE INDEX obligations_cycle_association_idx ON public.installment_obligations USING btree (cycle_id, association_id);

CREATE INDEX obligations_membership_association_idx ON public.installment_obligations USING btree (membership_id, association_id);

CREATE INDEX obligations_period_cycle_association_idx ON public.installment_obligations USING btree (period_id, cycle_id, association_id);

CREATE INDEX periods_association_cycle_idx ON public.installment_periods USING btree (association_id, cycle_id, installment_no);

CREATE INDEX periods_cycle_association_idx ON public.installment_periods USING btree (cycle_id, association_id);

CREATE UNIQUE INDEX installment_receipts_one_active_per_obligation ON public.installment_receipts USING btree (obligation_id) WHERE (status = 'active'::text);

CREATE INDEX receipts_association_recorded_idx ON public.installment_receipts USING btree (association_id, recorded_at DESC);

CREATE INDEX receipts_member_association_beneficiary_idx ON public.installment_receipts USING btree (membership_id, association_id, beneficiary_user_id);

CREATE INDEX receipts_obligation_association_membership_idx ON public.installment_receipts USING btree (obligation_id, association_id, membership_id);

CREATE INDEX receipts_recorded_by_idx ON public.installment_receipts USING btree (recorded_by_user_id);

CREATE INDEX invitations_association_status_idx ON public.invitations USING btree (association_id, status, created_at DESC);

CREATE INDEX invitations_creator_idx ON public.invitations USING btree (created_by);

CREATE INDEX invitations_invited_user_idx ON public.invitations USING btree (invited_user_id);

CREATE INDEX notifications_association_idx ON public.notifications USING btree (association_id);

CREATE INDEX notifications_user_unread_idx ON public.notifications USING btree (user_id, read_at, created_at DESC);

CREATE INDEX corrections_receipt_time_idx ON public.receipt_corrections USING btree (receipt_id, corrected_at DESC);

CREATE INDEX receipt_corrections_corrector_idx ON public.receipt_corrections USING btree (corrected_by_user_id);

CREATE INDEX receipt_corrections_receipt_association_idx ON public.receipt_corrections USING btree (receipt_id, association_id);

CREATE INDEX reminders_obligation_association_idx ON public.reminders USING btree (obligation_id, association_id);

CREATE INDEX reminders_obligation_time_idx ON public.reminders USING btree (obligation_id, sent_at DESC);

CREATE INDEX reminders_recipient_idx ON public.reminders USING btree (recipient_user_id);

CREATE INDEX reminders_sender_idx ON public.reminders USING btree (sent_by_user_id);

CREATE INDEX shares_association_member_idx ON public.shares USING btree (association_id, membership_id, status);

CREATE INDEX shares_membership_association_idx ON public.shares USING btree (membership_id, association_id);

CREATE OR REPLACE FUNCTION private.accept_invitation(p_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
 v_uid uuid:=auth.uid(); v_inv public.invitations%ROWTYPE; v_assoc public.associations%ROWTYPE;
 v_membership uuid; v_existing uuid; v_share_no integer; v_added integer:=0; v_cycle record; v_period record; v_event uuid;
BEGIN
 IF v_uid IS NULL THEN RAISE EXCEPTION 'يجب تسجيل الدخول' USING ERRCODE='28000'; END IF;
 IF p_token IS NULL OR length(p_token)<40 THEN RAISE EXCEPTION 'رمز الدعوة غير صالح' USING ERRCODE='22023'; END IF;
 SELECT * INTO v_inv FROM public.invitations
 WHERE token_hash=encode(extensions.digest(convert_to(p_token,'UTF8'),'sha256'),'hex')
   AND status='pending' AND (expires_at IS NULL OR expires_at>now())
 FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'الدعوة غير موجودة أو منتهية أو سبق استخدامها' USING ERRCODE='22023'; END IF;
 SELECT * INTO v_assoc FROM public.associations WHERE id=v_inv.association_id FOR UPDATE;
 IF v_assoc.locked_at IS NOT NULL OR v_assoc.status<>'active' THEN RAISE EXCEPTION 'أُغلقت العضويات بعد تثبيت أول قرعة' USING ERRCODE='23514'; END IF;
 IF EXISTS(SELECT 1 FROM public.association_memberships WHERE association_id=v_assoc.id AND user_id=v_uid) THEN
   RAISE EXCEPTION 'هذا الحساب عضو بالفعل في الجمعية' USING ERRCODE='23505';
 END IF;
 IF v_inv.shares_requested>v_assoc.max_shares_per_member THEN RAISE EXCEPTION 'عدد الأسهم يتجاوز الحد المسموح للفرد' USING ERRCODE='23514'; END IF;
 SELECT count(*) INTO v_share_no FROM public.shares WHERE association_id=v_assoc.id AND status='active';
 IF v_share_no+v_inv.shares_requested>v_assoc.target_shares THEN RAISE EXCEPTION 'لم تعد هناك أسهم متاحة بهذا العدد' USING ERRCODE='23514'; END IF;
 INSERT INTO public.association_memberships(association_id,user_id) VALUES(v_assoc.id,v_uid) RETURNING id INTO v_membership;
 SELECT coalesce(max(share_no),0) INTO v_share_no FROM public.shares WHERE association_id=v_assoc.id;
 FOR v_added IN 1..v_inv.shares_requested LOOP
   INSERT INTO public.shares(association_id,membership_id,share_no) VALUES(v_assoc.id,v_membership,v_share_no+v_added);
 END LOOP;
 FOR v_cycle IN SELECT * FROM public.association_cycles WHERE association_id=v_assoc.id ORDER BY cycle_no LOOP
   FOR v_period IN SELECT * FROM public.installment_periods WHERE cycle_id=v_cycle.id ORDER BY installment_no LOOP
     INSERT INTO public.installment_obligations(association_id,cycle_id,membership_id,period_id,shares_count,amount_minor,currency)
     VALUES(v_assoc.id,v_cycle.id,v_membership,v_period.id,v_inv.shares_requested,
            v_period.per_share_amount_minor*v_inv.shares_requested,v_cycle.currency)
     ON CONFLICT(membership_id,period_id) DO NOTHING;
   END LOOP;
 END LOOP;
 UPDATE public.invitations SET status='accepted',invited_user_id=v_uid,accepted_at=now() WHERE id=v_inv.id;
 INSERT INTO public.association_events(association_id,actor_user_id,event_type,entity_type,entity_id,visibility,after_data)
 VALUES(v_assoc.id,v_uid,'member_joined','membership',v_membership,'all',jsonb_build_object('shares',v_inv.shares_requested)) RETURNING id INTO v_event;
 IF EXISTS(SELECT 1 FROM public.association_notification_settings s WHERE s.association_id=v_assoc.id AND 'joined'=ANY(s.enabled_types)) THEN
   INSERT INTO public.chat_messages(association_id,kind,body,system_type,event_id)
   VALUES(v_assoc.id,'system','انضم عضو جديد إلى الجمعية','joined',v_event);
 END IF;
 RETURN jsonb_build_object('membership_id',v_membership,'association_id',v_assoc.id,'shares_added',v_inv.shares_requested);
END;
$function$
;

CREATE OR REPLACE FUNCTION private.can_view_association(p_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$ SELECT private.is_association_manager(p_id) OR private.is_association_member(p_id); $function$
;

CREATE OR REPLACE FUNCTION private.can_view_event(p_aid uuid, p_visibility text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$ SELECT private.is_association_manager(p_aid) OR (private.is_association_member(p_aid) AND p_visibility IN ('member','all')); $function$
;

CREATE OR REPLACE FUNCTION private.can_view_profile(p_uid uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 SELECT p_uid=(SELECT auth.uid())
 OR EXISTS(SELECT 1 FROM public.associations a JOIN public.association_memberships m ON m.association_id=a.id WHERE a.manager_user_id=(SELECT auth.uid()) AND m.user_id=p_uid AND m.status='active')
 OR EXISTS(SELECT 1 FROM public.association_memberships mine JOIN public.association_memberships theirs ON theirs.association_id=mine.association_id AND theirs.status='active' WHERE mine.user_id=(SELECT auth.uid()) AND mine.status='active' AND theirs.user_id=p_uid)
 OR EXISTS(SELECT 1 FROM public.association_memberships mine JOIN public.associations a ON a.id=mine.association_id WHERE mine.user_id=(SELECT auth.uid()) AND mine.status='active' AND a.manager_user_id=p_uid);
$function$
;

CREATE OR REPLACE FUNCTION private.correct_installment_receipt(p_receipt_id uuid, p_reason text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
 v_uid uuid:=auth.uid(); v_r public.installment_receipts%ROWTYPE; v_correction uuid;
 v_before jsonb; v_after jsonb; v_event uuid;
BEGIN
 IF v_uid IS NULL THEN RAISE EXCEPTION 'يجب تسجيل الدخول' USING ERRCODE='28000'; END IF;
 SELECT * INTO v_r FROM public.installment_receipts WHERE id=p_receipt_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'سجل الاستلام غير موجود' USING ERRCODE='P0002'; END IF;
 IF NOT private.is_association_manager(v_r.association_id) THEN RAISE EXCEPTION 'تصحيح الاستلام متاح لمدير الجمعية فقط' USING ERRCODE='42501'; END IF;
 IF v_r.status<>'active' THEN RAISE EXCEPTION 'سبق تصحيح سجل الاستلام' USING ERRCODE='23514'; END IF;
 IF p_reason IS NULL OR length(btrim(p_reason))<3 THEN RAISE EXCEPTION 'سبب التصحيح مطلوب' USING ERRCODE='22023'; END IF;
 v_before:=to_jsonb(v_r);
 UPDATE public.installment_receipts SET status='voided' WHERE id=p_receipt_id;
 SELECT to_jsonb(r) INTO v_after FROM public.installment_receipts r WHERE r.id=p_receipt_id;
 INSERT INTO public.receipt_corrections(association_id,receipt_id,corrected_by_user_id,reason,action,before_snapshot,after_snapshot)
 VALUES(v_r.association_id,v_r.id,v_uid,btrim(p_reason),'void',v_before,v_after) RETURNING id INTO v_correction;
 INSERT INTO public.association_events(association_id,actor_user_id,event_type,entity_type,entity_id,visibility,before_data,after_data)
 VALUES(v_r.association_id,v_uid,'receipt_corrected','receipt',v_r.id,'manager',v_before,v_after) RETURNING id INTO v_event;
 RETURN v_correction;
END;
$function$
;

CREATE OR REPLACE FUNCTION private.create_association(p_payload jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
 v_uid uuid := auth.uid();
 v_name text;
 v_currency text;
 v_start date;
 v_tz text;
 v_cycle_type text;
 v_days integer;
 v_amount bigint;
 v_installments integer;
 v_target integer;
 v_max_per integer;
 v_manager_participates boolean;
 v_manager_shares integer;
 v_quorum integer;
 v_rules text;
 v_id uuid;
 v_membership uuid;
 v_cycle uuid;
 v_period uuid;
 v_i integer;
 v_days_base integer;
 v_days_rem integer;
 v_amount_base bigint;
 v_amount_rem bigint;
 v_period_days integer;
 v_period_amount bigint;
 v_cursor date;
 v_share_no integer := 0;
BEGIN
 IF v_uid IS NULL THEN RAISE EXCEPTION 'يجب تسجيل الدخول' USING ERRCODE='28000'; END IF;
 v_name := nullif(btrim(p_payload->>'name'),'');
 v_currency := p_payload->>'currency';
 v_start := (p_payload->>'startDate')::date;
 v_tz := coalesce(nullif(p_payload->>'tz',''),'Asia/Aden');
 v_cycle_type := p_payload->>'cycleType';
 v_days := CASE v_cycle_type WHEN 'weekly' THEN 7 WHEN 'monthly' THEN 30 WHEN 'custom' THEN (p_payload->>'cycleDays')::integer ELSE NULL END;
 v_amount := (p_payload->>'shareAmountMinor')::bigint;
 v_installments := (p_payload->>'installments')::integer;
 v_target := (p_payload->>'targetShares')::integer;
 v_max_per := (p_payload->>'maxPerMember')::integer;
 v_manager_participates := coalesce((p_payload->>'managerParticipates')::boolean,false);
 v_manager_shares := CASE WHEN v_manager_participates THEN coalesce((p_payload->>'managerShares')::integer,0) ELSE 0 END;
 v_quorum := coalesce((p_payload->>'quorum')::integer,66);
 v_rules := coalesce(p_payload->>'rules','');

 IF v_name IS NULL OR length(v_name) NOT BETWEEN 2 AND 120 THEN RAISE EXCEPTION 'اسم الجمعية غير صالح' USING ERRCODE='22023'; END IF;
 IF v_currency NOT IN ('YER','SAR','USD') THEN RAISE EXCEPTION 'العملة غير مدعومة' USING ERRCODE='22023'; END IF;
 IF v_days IS NULL OR v_days NOT BETWEEN 1 AND 3650 THEN RAISE EXCEPTION 'مدة الدورة غير صالحة' USING ERRCODE='22023'; END IF;
 IF v_amount IS NULL OR v_amount<=0 OR v_installments IS NULL OR v_installments NOT BETWEEN 1 AND v_days THEN RAISE EXCEPTION 'إعدادات الأقساط غير صالحة' USING ERRCODE='22023'; END IF;
 IF v_target IS NULL OR v_target<1 OR v_max_per IS NULL OR v_max_per NOT BETWEEN 1 AND v_target THEN RAISE EXCEPTION 'حدود الأسهم غير صالحة' USING ERRCODE='22023'; END IF;
 IF (v_manager_participates AND v_manager_shares<1) OR v_manager_shares<0 OR v_manager_shares>v_max_per OR v_manager_shares>v_target THEN RAISE EXCEPTION 'عدد أسهم المدير غير صالح' USING ERRCODE='22023'; END IF;
 IF v_quorum NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'نصاب الحضور غير صالح' USING ERRCODE='22023'; END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_timezone_names WHERE name=v_tz) THEN RAISE EXCEPTION 'المنطقة الزمنية غير معروفة' USING ERRCODE='22023'; END IF;

 INSERT INTO public.associations(manager_user_id,name,currency,start_date,invite_opens_on,invite_closes_on,time_zone,cycle_type,cycle_days,share_amount_minor,installments_count,target_shares,max_shares_per_member,manager_participates,quorum_percent,rules)
 VALUES(v_uid,v_name,v_currency,v_start,nullif(p_payload->>'inviteOpensOn','')::date,nullif(p_payload->>'inviteClosesOn','')::date,v_tz,v_cycle_type,v_days,v_amount,v_installments,v_target,v_max_per,v_manager_participates,v_quorum,v_rules)
 RETURNING id INTO v_id;

 INSERT INTO public.association_notification_settings(association_id,updated_by_user_id) VALUES(v_id,v_uid);

 IF v_manager_participates THEN
   INSERT INTO public.association_memberships(association_id,user_id) VALUES(v_id,v_uid) RETURNING id INTO v_membership;
   FOR v_share_no IN 1..v_manager_shares LOOP
     INSERT INTO public.shares(association_id,membership_id,share_no) VALUES(v_id,v_membership,v_share_no);
   END LOOP;
 END IF;

 INSERT INTO public.association_cycles(association_id,cycle_no,starts_on,ends_on,duration_days,currency,share_amount_minor,installments_count,cycle_type)
 VALUES(v_id,1,v_start,v_start+(v_days-1),v_days,v_currency,v_amount,v_installments,v_cycle_type)
 RETURNING id INTO v_cycle;

 v_days_base := v_days / v_installments;
 v_days_rem := v_days % v_installments;
 v_amount_base := v_amount / v_installments;
 v_amount_rem := v_amount % v_installments;
 v_cursor := v_start;

 FOR v_i IN 1..v_installments LOOP
   v_period_days := v_days_base + CASE WHEN v_i<=v_days_rem THEN 1 ELSE 0 END;
   v_period_amount := v_amount_base + CASE WHEN v_i<=v_amount_rem THEN 1 ELSE 0 END;
   INSERT INTO public.installment_periods(association_id,cycle_id,installment_no,starts_on,ends_on,per_share_amount_minor)
   VALUES(v_id,v_cycle,v_i,v_cursor,v_cursor+(v_period_days-1),v_period_amount)
   RETURNING id INTO v_period;

   IF v_manager_participates AND v_manager_shares>0 THEN
     INSERT INTO public.installment_obligations(association_id,cycle_id,membership_id,period_id,shares_count,amount_minor,currency)
     VALUES(v_id,v_cycle,v_membership,v_period,v_manager_shares,v_period_amount*v_manager_shares,v_currency);
   END IF;
   v_cursor := v_cursor+v_period_days;
 END LOOP;

 INSERT INTO public.association_events(association_id,actor_user_id,event_type,entity_type,entity_id,visibility,after_data)
 VALUES(v_id,v_uid,'association_created','association',v_id,'all',
   jsonb_build_object('name',v_name,'currency',v_currency,'cycle_days',v_days,'installments',v_installments,'target_shares',v_target,'manager_participates',v_manager_participates));

 RETURN v_id;
END;
$function$
;

CREATE OR REPLACE FUNCTION private.create_invitation(p_association_id uuid, p_name text, p_phone text, p_shares integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
 v_uid uuid:=auth.uid(); v_token text; v_id uuid; v_count integer; v_target integer; v_max integer;
BEGIN
 IF v_uid IS NULL THEN RAISE EXCEPTION 'يجب تسجيل الدخول' USING ERRCODE='28000'; END IF;
 SELECT target_shares,max_shares_per_member INTO v_target,v_max
 FROM public.associations WHERE id=p_association_id AND manager_user_id=v_uid AND locked_at IS NULL AND status='active' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'الجمعية غير موجودة أو لا تملك صلاحية إدارتها أو أُقفلت العضويات' USING ERRCODE='42501'; END IF;
 IF p_name IS NULL OR length(btrim(p_name)) NOT BETWEEN 2 AND 120 OR p_shares NOT BETWEEN 1 AND v_max THEN
   RAISE EXCEPTION 'بيانات الدعوة أو عدد الأسهم غير صالح' USING ERRCODE='22023';
 END IF;
 SELECT count(*) INTO v_count FROM public.shares WHERE association_id=p_association_id AND status='active';
 IF v_count+p_shares>v_target THEN RAISE EXCEPTION 'عدد الأسهم يتجاوز العدد المستهدف' USING ERRCODE='23514'; END IF;
 v_token:=encode(extensions.digest(convert_to(gen_random_uuid()::text||gen_random_uuid()::text,'UTF8'),'sha256'),'hex');
 INSERT INTO public.invitations(association_id,created_by,invitee_name,invitee_phone_e164,shares_requested,token_hash,expires_at)
 VALUES(p_association_id,v_uid,btrim(p_name),CASE WHEN nullif(p_phone,'') IS NULL THEN NULL ELSE private.normalize_phone_e164(p_phone) END,p_shares,
        encode(extensions.digest(convert_to(v_token,'UTF8'),'sha256'),'hex'),now()+interval '30 days')
 RETURNING id INTO v_id;
 INSERT INTO public.association_events(association_id,actor_user_id,event_type,entity_type,entity_id,visibility,after_data)
 VALUES(p_association_id,v_uid,'invitation_created','invitation',v_id,'manager',jsonb_build_object('invitee_name',btrim(p_name),'shares',p_shares));
 RETURN jsonb_build_object('id',v_id,'token',v_token,'expires_in_days',30);
END;
$function$
;

CREATE OR REPLACE FUNCTION private.guard_append_only_history()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  IF TG_OP='DELETE' THEN
    RAISE EXCEPTION 'السجل التاريخي لا يحذف؛ استخدم إجراء تصحيح موثق' USING ERRCODE='55000';
  END IF;
  IF TG_TABLE_SCHEMA='public' AND TG_TABLE_NAME='installment_receipts' AND TG_OP='UPDATE' THEN
    IF OLD.status='active' AND NEW.status='voided'
       AND (to_jsonb(NEW)-'status')=(to_jsonb(OLD)-'status') THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'لا يسمح بتعديل سجل الاستلام؛ استخدم إجراء التصحيح' USING ERRCODE='55000';
  END IF;
  RAISE EXCEPTION 'هذا السجل append-only ولا يسمح بتعديله' USING ERRCODE='55000';
END;
$function$
;

CREATE OR REPLACE FUNCTION private.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_name text; v_phone text; v_city text;
BEGIN
 v_name:=nullif(btrim(new.raw_user_meta_data->>'full_name'),'');
 IF v_name IS NULL OR length(v_name)<2 THEN RAISE EXCEPTION 'الاسم الكامل مطلوب' USING ERRCODE='22023'; END IF;
 v_phone:=private.normalize_phone_e164(new.raw_user_meta_data->>'phone');
 v_city:=nullif(btrim(new.raw_user_meta_data->>'city'),'');
 INSERT INTO public.profiles(id,full_name) VALUES(new.id,v_name);
 INSERT INTO public.profile_private(user_id,phone_e164,city) VALUES(new.id,v_phone,v_city);
 INSERT INTO public.user_preferences(user_id) VALUES(new.id);
 RETURN new;
END;
$function$
;

CREATE OR REPLACE FUNCTION private.is_association_manager(p_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$ SELECT EXISTS(SELECT 1 FROM public.associations a WHERE a.id=p_id AND a.manager_user_id=(SELECT auth.uid())); $function$
;

CREATE OR REPLACE FUNCTION private.is_association_member(p_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$ SELECT EXISTS(SELECT 1 FROM public.association_memberships m WHERE m.association_id=p_id AND m.user_id=(SELECT auth.uid()) AND m.status='active'); $function$
;

CREATE OR REPLACE FUNCTION private.mark_my_notification_read(p_notification_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_uid uuid:=auth.uid(); v_count integer;
BEGIN
 IF v_uid IS NULL THEN RAISE EXCEPTION 'يجب تسجيل الدخول' USING ERRCODE='28000'; END IF;
 UPDATE public.notifications SET read_at=coalesce(read_at,now()) WHERE id=p_notification_id AND user_id=v_uid;
 GET DIAGNOSTICS v_count=ROW_COUNT;
 RETURN v_count=1;
END;
$function$
;

CREATE OR REPLACE FUNCTION private.normalize_phone_e164(p_phone text)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
DECLARE v text;
BEGIN
 v:=translate(coalesce(p_phone,''),'٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹','01234567890123456789');
 v:=regexp_replace(v,'[[:space:]().-]','','g'); v:=regexp_replace(v,'[^0-9+]','','g');
 IF left(v,2)='00' THEN v:='+'||substr(v,3); END IF;
 IF v !~ '^[+][1-9][0-9]{7,14}$' THEN RAISE EXCEPTION 'رقم الهاتف يجب أن يكون بصيغة دولية E.164' USING ERRCODE='22023'; END IF;
 RETURN v;
END;
$function$
;

CREATE OR REPLACE FUNCTION private.owns_membership(p_mid uuid, p_aid uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$ SELECT EXISTS(SELECT 1 FROM public.association_memberships m WHERE m.id=p_mid AND m.association_id=p_aid AND m.user_id=(SELECT auth.uid()) AND m.status='active'); $function$
;

CREATE OR REPLACE FUNCTION private.perform_draw(p_association_id uuid, p_expected_round_no integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
 v_uid uuid:=auth.uid(); v_a public.associations%ROWTYPE; v_cycle public.association_cycles%ROWTYPE;
 v_round integer; v_total_shares integer; v_people integer; v_present integer; v_required integer;
 v_candidates uuid[]; v_n integer; v_limit bigint; v_rand bigint; v_bytes bytea; v_index integer;
 v_winner uuid; v_draw uuid; v_event uuid; v_cycle_no integer; v_installment_no integer;
 v_days_base integer; v_days_rem integer; v_amount_base bigint; v_amount_rem bigint;
 v_pd integer; v_pa bigint; v_cursor date; v_period uuid; v_m record; v_c uuid; v_cycle_start date;
BEGIN
 IF v_uid IS NULL THEN RAISE EXCEPTION 'يجب تسجيل الدخول' USING ERRCODE='28000'; END IF;
 IF p_expected_round_no IS NULL OR p_expected_round_no<1 THEN RAISE EXCEPTION 'رقم الجولة غير صالح' USING ERRCODE='22023'; END IF;
 SELECT * INTO v_a FROM public.associations WHERE id=p_association_id AND manager_user_id=v_uid AND status='active' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'القرعة متاحة لمدير الجمعية فقط' USING ERRCODE='42501'; END IF;
 SELECT count(*)+1 INTO v_round FROM public.draws WHERE association_id=p_association_id;
 IF v_round<>p_expected_round_no THEN RAISE EXCEPTION 'تم تحديث حالة القرعة؛ أعد تحميل الجولة الحالية' USING ERRCODE='40001'; END IF;
 SELECT * INTO v_cycle FROM public.association_cycles WHERE association_id=p_association_id AND cycle_no=v_round FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'دورة القرعة غير مهيأة' USING ERRCODE='23514'; END IF;
 IF (now() AT TIME ZONE v_a.time_zone)::date < v_cycle.ends_on+1 THEN RAISE EXCEPTION 'لم يحل موعد القرعة بعد' USING ERRCODE='22023'; END IF;
 SELECT count(*) INTO v_total_shares FROM public.shares WHERE association_id=p_association_id AND status='active';
 SELECT count(*) INTO v_people FROM public.association_memberships WHERE association_id=p_association_id AND status='active';
 SELECT count(*) INTO v_present FROM public.cycle_attendance ca
 JOIN public.association_memberships m ON m.id=ca.membership_id
 WHERE ca.association_id=p_association_id AND ca.cycle_id=v_cycle.id AND ca.present AND m.status='active';
 v_required:=ceil(v_people*v_a.quorum_percent/100.0)::integer;
 IF v_people=0 OR v_present<v_required THEN RAISE EXCEPTION 'لم يكتمل نصاب الحضور' USING ERRCODE='23514'; END IF;
 IF v_total_shares=0 THEN RAISE EXCEPTION 'لا توجد أسهم مؤهلة' USING ERRCODE='23514'; END IF;
 SELECT array_agg(s.id ORDER BY s.id) INTO v_candidates
 FROM public.shares s WHERE s.association_id=p_association_id AND s.status='active'
 AND NOT EXISTS(SELECT 1 FROM public.draws d WHERE d.winner_share_id=s.id);
 v_n:=coalesce(array_length(v_candidates,1),0);
 IF v_n=0 THEN RAISE EXCEPTION 'لا توجد أسهم مؤهلة لهذه القرعة' USING ERRCODE='23514'; END IF;
 v_limit:=floor(4294967296::numeric/v_n)::bigint*v_n;
 LOOP
   v_bytes:=extensions.gen_random_bytes(4);
   v_rand:=get_byte(v_bytes,0)::bigint*16777216 + get_byte(v_bytes,1)::bigint*65536 + get_byte(v_bytes,2)::bigint*256 + get_byte(v_bytes,3)::bigint;
   EXIT WHEN v_rand<v_limit;
 END LOOP;
 v_index:=(v_rand%v_n)::integer+1;
 v_winner:=v_candidates[v_index];
 INSERT INTO public.draws(association_id,cycle_id,round_no,scheduled_on,winner_share_id,share_count_at_draw,eligible_count,prize_target_minor,quorum_people,quorum_required,algorithm_version)
 VALUES(p_association_id,v_cycle.id,v_round,v_cycle.ends_on+1,v_winner,v_total_shares,v_n,v_a.share_amount_minor*v_total_shares,v_people,v_required,'pgcrypto-rejection-v1')
 RETURNING id INTO v_draw;
 INSERT INTO public.draw_eligible_shares(association_id,draw_id,share_id)
 SELECT p_association_id,v_draw,x FROM unnest(v_candidates) AS x;
 UPDATE public.association_cycles SET status='drawn' WHERE id=v_cycle.id;
 IF v_round=1 THEN
   UPDATE public.associations SET locked_at=now(),locked_share_count=v_total_shares WHERE id=p_association_id AND locked_at IS NULL;
   FOR v_cycle_no IN 2..v_total_shares LOOP
     v_cycle_start:=v_a.start_date+(v_cycle_no-1)*v_a.cycle_days;
     INSERT INTO public.association_cycles(association_id,cycle_no,starts_on,ends_on,duration_days,currency,share_amount_minor,installments_count,cycle_type)
     VALUES(p_association_id,v_cycle_no,v_cycle_start,v_cycle_start+v_a.cycle_days-1,v_a.cycle_days,v_a.currency,v_a.share_amount_minor,v_a.installments_count,v_a.cycle_type)
     RETURNING id INTO v_c;
     v_days_base:=v_a.cycle_days/v_a.installments_count; v_days_rem:=v_a.cycle_days%v_a.installments_count;
     v_amount_base:=v_a.share_amount_minor/v_a.installments_count; v_amount_rem:=v_a.share_amount_minor%v_a.installments_count;
     v_cursor:=v_cycle_start;
     FOR v_installment_no IN 1..v_a.installments_count LOOP
       v_pd:=v_days_base+CASE WHEN v_installment_no<=v_days_rem THEN 1 ELSE 0 END;
       v_pa:=v_amount_base+CASE WHEN v_installment_no<=v_amount_rem THEN 1 ELSE 0 END;
       INSERT INTO public.installment_periods(association_id,cycle_id,installment_no,starts_on,ends_on,per_share_amount_minor)
       VALUES(p_association_id,v_c,v_installment_no,v_cursor,v_cursor+v_pd-1,v_pa) RETURNING id INTO v_period;
       FOR v_m IN
         SELECT m.id,count(s.id)::integer AS shares_count
         FROM public.association_memberships m JOIN public.shares s ON s.membership_id=m.id AND s.status='active'
         WHERE m.association_id=p_association_id AND m.status='active' GROUP BY m.id
       LOOP
         INSERT INTO public.installment_obligations(association_id,cycle_id,membership_id,period_id,shares_count,amount_minor,currency)
         VALUES(p_association_id,v_c,v_m.id,v_period,v_m.shares_count,v_pa*v_m.shares_count,v_a.currency);
       END LOOP;
       v_cursor:=v_cursor+v_pd;
     END LOOP;
   END LOOP;
 END IF;
 INSERT INTO public.association_events(association_id,actor_user_id,event_type,entity_type,entity_id,visibility,after_data)
 VALUES(p_association_id,v_uid,'draw_result','draw',v_draw,'all',jsonb_build_object('round',v_round,'winner_share_id',v_winner,'eligible_count',v_n,'prize_target_minor',v_a.share_amount_minor*v_total_shares))
 RETURNING id INTO v_event;
 IF EXISTS(SELECT 1 FROM public.association_notification_settings s WHERE s.association_id=p_association_id AND 'drawResult'=ANY(s.enabled_types)) THEN
   INSERT INTO public.chat_messages(association_id,kind,body,system_type,event_id)
   VALUES(p_association_id,'system','تم تثبيت نتيجة القرعة','drawResult',v_event);
 END IF;
 INSERT INTO public.notifications(user_id,association_id,type,title,body,related_entity_id,idempotency_key)
 SELECT m.user_id,p_association_id,'drawResult','نتيجة القرعة','تم تثبيت نتيجة قرعة الجمعية',v_draw,
        'draw:'||v_draw::text||':'||m.user_id::text
 FROM public.association_memberships m
 LEFT JOIN public.user_preferences up ON up.user_id=m.user_id
 WHERE m.association_id=p_association_id AND m.status='active' AND coalesce(up.notifications_enabled,true)=true
 ON CONFLICT(idempotency_key) DO NOTHING;
 RETURN jsonb_build_object('draw_id',v_draw,'round',v_round,'winner_share_id',v_winner,'eligible_count',v_n,'locked',(v_round=1));
END;
$function$
;

CREATE OR REPLACE FUNCTION private.record_installment_receipt(p_obligation_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
 v_uid uuid:=auth.uid(); v_o public.installment_obligations%ROWTYPE; v_a public.associations%ROWTYPE;
 v_receipt uuid; v_event uuid; v_beneficiary uuid; v_name text; v_body text;
BEGIN
 IF v_uid IS NULL THEN RAISE EXCEPTION 'يجب تسجيل الدخول' USING ERRCODE='28000'; END IF;
 SELECT * INTO v_o FROM public.installment_obligations WHERE id=p_obligation_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'الالتزام غير موجود' USING ERRCODE='P0002'; END IF;
 SELECT * INTO v_a FROM public.associations WHERE id=v_o.association_id AND manager_user_id=v_uid FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'تسجيل الاستلام متاح لمدير الجمعية فقط' USING ERRCODE='42501'; END IF;
 SELECT user_id INTO v_beneficiary FROM public.association_memberships WHERE id=v_o.membership_id;
 IF v_beneficiary IS NULL THEN RAISE EXCEPTION 'عضوية المستفيد غير موجودة' USING ERRCODE='23503'; END IF;
 INSERT INTO public.installment_receipts(association_id,obligation_id,membership_id,beneficiary_user_id,recorded_by_user_id,amount_minor,currency,self_recorded)
 VALUES(v_o.association_id,v_o.id,v_o.membership_id,v_beneficiary,v_uid,v_o.amount_minor,v_o.currency,(v_beneficiary=v_uid))
 RETURNING id INTO v_receipt;
 INSERT INTO public.association_events(association_id,actor_user_id,event_type,entity_type,entity_id,visibility,after_data)
 VALUES(v_o.association_id,v_uid,'installment_received','receipt',v_receipt,'all',
        jsonb_build_object('obligation_id',v_o.id,'amount_minor',v_o.amount_minor,'currency',v_o.currency,'self_recorded',(v_beneficiary=v_uid)))
 RETURNING id INTO v_event;
 v_body := 'سجّل مدير الجمعية استلام القسط المستحق';
 INSERT INTO public.notifications(user_id,association_id,type,title,body,related_entity_id,idempotency_key)
 VALUES(v_beneficiary,v_o.association_id,'received','تسجيل استلام قسط',v_body,v_receipt,'receipt:'||v_receipt::text||':'||v_beneficiary::text)
 ON CONFLICT(idempotency_key) DO NOTHING;
 IF EXISTS(SELECT 1 FROM public.association_notification_settings s WHERE s.association_id=v_o.association_id AND 'received'=ANY(s.enabled_types)) THEN
   INSERT INTO public.chat_messages(association_id,kind,body,system_type,event_id)
   VALUES(v_o.association_id,'system','تم تسجيل استلام قسط لأحد المشاركين','received',v_event);
 END IF;
 RETURN v_receipt;
END;
$function$
;

CREATE OR REPLACE FUNCTION private.send_chat_message(p_association_id uuid, p_body text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_uid uuid:=auth.uid(); v_message uuid; v_event uuid; v_name text;
BEGIN
 IF v_uid IS NULL THEN RAISE EXCEPTION 'يجب تسجيل الدخول' USING ERRCODE='28000'; END IF;
 IF p_body IS NULL OR char_length(btrim(p_body)) NOT BETWEEN 1 AND 50 THEN RAISE EXCEPTION 'الرسالة يجب أن تكون من حرف إلى 50 حرفًا' USING ERRCODE='22023'; END IF;
 IF NOT private.is_association_member(p_association_id) THEN RAISE EXCEPTION 'المحادثة متاحة لأعضاء الجمعية فقط' USING ERRCODE='42501'; END IF;
 INSERT INTO public.association_events(association_id,actor_user_id,event_type,entity_type,visibility,after_data)
 VALUES(p_association_id,v_uid,'chat_message_sent','chat_message','all',jsonb_build_object('body',btrim(p_body)))
 RETURNING id INTO v_event;
 INSERT INTO public.chat_messages(association_id,sender_user_id,kind,body,event_id)
 VALUES(p_association_id,v_uid,'member',btrim(p_body),v_event) RETURNING id INTO v_message;
 INSERT INTO public.notifications(user_id,association_id,type,title,body,related_entity_id,idempotency_key)
 SELECT m.user_id,p_association_id,'chat_message','رسالة جديدة','وصلت رسالة جديدة في محادثة الجمعية',v_message,'chat:'||v_message::text||':'||m.user_id::text
 FROM public.association_memberships m
 LEFT JOIN public.association_user_preferences pref ON pref.association_id=p_association_id AND pref.user_id=m.user_id
 LEFT JOIN public.user_preferences up ON up.user_id=m.user_id
 WHERE m.association_id=p_association_id AND m.status='active' AND m.user_id<>v_uid
   AND coalesce(pref.mute_group,false)=false AND coalesce(up.notifications_enabled,true)=true
 ON CONFLICT(idempotency_key) DO NOTHING;
 RETURN v_message;
END;
$function$
;

CREATE OR REPLACE FUNCTION private.send_installment_reminders(p_cycle_id uuid, p_installment_no integer, p_membership_id uuid DEFAULT NULL::uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_uid uuid:=auth.uid(); v_aid uuid; v_zone text; v_period public.installment_periods%ROWTYPE;
 v_today date; v_batch uuid:=gen_random_uuid(); v_count integer:=0; v_row record; v_reminder uuid;
BEGIN
 IF v_uid IS NULL THEN RAISE EXCEPTION 'يجب تسجيل الدخول' USING ERRCODE='28000'; END IF;
 SELECT c.association_id,a.time_zone INTO v_aid,v_zone FROM public.association_cycles c
 JOIN public.associations a ON a.id=c.association_id WHERE c.id=p_cycle_id;
 IF v_aid IS NULL OR NOT private.is_association_manager(v_aid) THEN RAISE EXCEPTION 'التذكير متاح لمدير الجمعية فقط' USING ERRCODE='42501'; END IF;
 SELECT * INTO v_period FROM public.installment_periods WHERE cycle_id=p_cycle_id AND installment_no=p_installment_no;
 IF NOT FOUND THEN RAISE EXCEPTION 'فترة القسط غير موجودة' USING ERRCODE='P0002'; END IF;
 v_today:=(now() AT TIME ZONE v_zone)::date;
 FOR v_row IN
   SELECT o.id,o.membership_id,m.user_id
   FROM public.installment_obligations o
   JOIN public.association_memberships m ON m.id=o.membership_id AND m.status='active'
   LEFT JOIN public.installment_receipts r ON r.obligation_id=o.id AND r.status='active'
   LEFT JOIN public.association_user_preferences pref ON pref.association_id=v_aid AND pref.user_id=m.user_id
   LEFT JOIN public.user_preferences up ON up.user_id=m.user_id
   WHERE o.association_id=v_aid AND o.period_id=v_period.id AND r.id IS NULL
     AND v_today>=v_period.starts_on
     AND (p_membership_id IS NULL OR o.membership_id=p_membership_id)
     AND coalesce(pref.mute_reminders,false)=false AND coalesce(up.notifications_enabled,true)=true
 LOOP
   INSERT INTO public.reminders(association_id,obligation_id,recipient_user_id,sent_by_user_id,batch_id)
   VALUES(v_aid,v_row.id,v_row.user_id,v_uid,v_batch) RETURNING id INTO v_reminder;
   INSERT INTO public.notifications(user_id,association_id,type,title,body,related_entity_id,idempotency_key)
   VALUES(v_row.user_id,v_aid,'reminder','تذكير بالقسط','لديك قسط مستحق أو متأخر في الجمعية',v_row.id,'reminder:'||v_reminder::text)
   ON CONFLICT(idempotency_key) DO NOTHING;
   v_count:=v_count+1;
 END LOOP;
 INSERT INTO public.association_events(association_id,actor_user_id,event_type,entity_type,entity_id,visibility,after_data)
 VALUES(v_aid,v_uid,'reminders_sent','installment_period',v_period.id,'manager',jsonb_build_object('recipients',v_count,'batch_id',v_batch));
 RETURN v_count;
END;
$function$
;

CREATE OR REPLACE FUNCTION private.set_association_notification_types(p_association_id uuid, p_enabled_types text[])
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_uid uuid:=auth.uid(); v_allowed text[]:=ARRAY['received','completed','late','drawSoon','drawDue','drawResult','joined','motivate'];
BEGIN
 IF v_uid IS NULL OR NOT private.is_association_manager(p_association_id) THEN RAISE EXCEPTION 'إعدادات النشر متاحة لمدير الجمعية فقط' USING ERRCODE='42501'; END IF;
 IF p_enabled_types IS NULL OR EXISTS(SELECT 1 FROM unnest(p_enabled_types) x WHERE NOT x=ANY(v_allowed)) THEN
   RAISE EXCEPTION 'نوع إشعار غير معروف' USING ERRCODE='22023';
 END IF;
 INSERT INTO public.association_notification_settings(association_id,enabled_types,updated_by_user_id,updated_at)
 VALUES(p_association_id,p_enabled_types,v_uid,now())
 ON CONFLICT(association_id) DO UPDATE SET enabled_types=excluded.enabled_types,updated_by_user_id=excluded.updated_by_user_id,updated_at=now();
END;
$function$
;

CREATE OR REPLACE FUNCTION private.set_association_user_preferences(p_association_id uuid, p_mute_group boolean, p_mute_reminders boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_uid uuid:=auth.uid();
BEGIN
 IF v_uid IS NULL OR NOT private.is_association_member(p_association_id) THEN RAISE EXCEPTION 'تفضيلات الجمعية متاحة لأعضائها فقط' USING ERRCODE='42501'; END IF;
 INSERT INTO public.association_user_preferences(association_id,user_id,mute_group,mute_reminders,updated_at)
 VALUES(p_association_id,v_uid,p_mute_group,p_mute_reminders,now())
 ON CONFLICT(association_id,user_id) DO UPDATE SET mute_group=excluded.mute_group,mute_reminders=excluded.mute_reminders,updated_at=now();
END;
$function$
;

CREATE OR REPLACE FUNCTION private.set_cycle_attendance(p_cycle_id uuid, p_membership_id uuid, p_present boolean)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_uid uuid:=auth.uid(); v_aid uuid; v_id uuid;
BEGIN
 IF v_uid IS NULL THEN RAISE EXCEPTION 'يجب تسجيل الدخول' USING ERRCODE='28000'; END IF;
 SELECT association_id INTO v_aid FROM public.association_cycles WHERE id=p_cycle_id;
 IF v_aid IS NULL OR NOT private.is_association_manager(v_aid) THEN RAISE EXCEPTION 'إدارة الحضور متاحة لمدير الجمعية فقط' USING ERRCODE='42501'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.association_memberships WHERE id=p_membership_id AND association_id=v_aid AND status='active') THEN
   RAISE EXCEPTION 'العضوية غير نشطة أو لا تتبع الجمعية' USING ERRCODE='22023';
 END IF;
 INSERT INTO public.cycle_attendance(association_id,cycle_id,membership_id,present,marked_by_user_id)
 VALUES(v_aid,p_cycle_id,p_membership_id,p_present,v_uid)
 ON CONFLICT(cycle_id,membership_id) DO UPDATE SET present=excluded.present,marked_by_user_id=excluded.marked_by_user_id,marked_at=now()
 RETURNING id INTO v_id;
 RETURN v_id;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.accept_invitation(p_token text)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO ''
AS $function$ SELECT private.accept_invitation(p_token); $function$
;

CREATE OR REPLACE FUNCTION public.correct_installment_receipt(p_receipt_id uuid, p_reason text)
 RETURNS uuid
 LANGUAGE sql
 SET search_path TO ''
AS $function$ SELECT private.correct_installment_receipt(p_receipt_id,p_reason); $function$
;

CREATE OR REPLACE FUNCTION public.create_association(p_payload jsonb)
 RETURNS uuid
 LANGUAGE sql
 SET search_path TO ''
AS $function$ SELECT private.create_association(p_payload); $function$
;

CREATE OR REPLACE FUNCTION public.create_invitation(p_association_id uuid, p_name text, p_phone text, p_shares integer)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO ''
AS $function$ SELECT private.create_invitation(p_association_id,p_name,p_phone,p_shares); $function$
;

CREATE OR REPLACE FUNCTION public.mark_my_notification_read(p_notification_id uuid)
 RETURNS boolean
 LANGUAGE sql
 SET search_path TO ''
AS $function$ SELECT private.mark_my_notification_read(p_notification_id); $function$
;

CREATE OR REPLACE FUNCTION public.perform_draw(p_association_id uuid, p_expected_round_no integer)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO ''
AS $function$ SELECT private.perform_draw(p_association_id,p_expected_round_no); $function$
;

CREATE OR REPLACE FUNCTION public.record_installment_receipt(p_obligation_id uuid)
 RETURNS uuid
 LANGUAGE sql
 SET search_path TO ''
AS $function$ SELECT private.record_installment_receipt(p_obligation_id); $function$
;

CREATE OR REPLACE FUNCTION public.rls_auto_enable()
 RETURNS event_trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  cmd record;
  tbl name;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        SELECT c.relname INTO tbl FROM pg_catalog.pg_class c WHERE c.oid = cmd.objid;
        EXECUTE format('alter table if exists %I.%I enable row level security', cmd.schema_name, tbl);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.send_chat_message(p_association_id uuid, p_body text)
 RETURNS uuid
 LANGUAGE sql
 SET search_path TO ''
AS $function$ SELECT private.send_chat_message(p_association_id,p_body); $function$
;

CREATE OR REPLACE FUNCTION public.send_installment_reminders(p_cycle_id uuid, p_installment_no integer, p_membership_id uuid DEFAULT NULL::uuid)
 RETURNS integer
 LANGUAGE sql
 SET search_path TO ''
AS $function$ SELECT private.send_installment_reminders(p_cycle_id,p_installment_no,p_membership_id); $function$
;

CREATE OR REPLACE FUNCTION public.set_association_notification_types(p_association_id uuid, p_enabled_types text[])
 RETURNS void
 LANGUAGE sql
 SET search_path TO ''
AS $function$ SELECT private.set_association_notification_types(p_association_id,p_enabled_types); $function$
;

CREATE OR REPLACE FUNCTION public.set_association_user_preferences(p_association_id uuid, p_mute_group boolean, p_mute_reminders boolean)
 RETURNS void
 LANGUAGE sql
 SET search_path TO ''
AS $function$ SELECT private.set_association_user_preferences(p_association_id,p_mute_group,p_mute_reminders); $function$
;

CREATE OR REPLACE FUNCTION public.set_cycle_attendance(p_cycle_id uuid, p_membership_id uuid, p_present boolean)
 RETURNS uuid
 LANGUAGE sql
 SET search_path TO ''
AS $function$ SELECT private.set_cycle_attendance(p_cycle_id,p_membership_id,p_present); $function$
;

CREATE POLICY cycles_select ON public.association_cycles AS PERMISSIVE FOR SELECT TO authenticated USING (private.can_view_association(association_id));

CREATE POLICY events_select ON public.association_events AS PERMISSIVE FOR SELECT TO authenticated USING (private.can_view_event(association_id, visibility));

CREATE POLICY memberships_select ON public.association_memberships AS PERMISSIVE FOR SELECT TO authenticated USING (private.can_view_association(association_id));

CREATE POLICY notification_settings_select ON public.association_notification_settings AS PERMISSIVE FOR SELECT TO authenticated USING (private.can_view_association(association_id));

CREATE POLICY association_prefs_insert ON public.association_user_preferences AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (((user_id = ( SELECT auth.uid() AS uid)) AND private.is_association_member(association_id)));

CREATE POLICY association_prefs_select ON public.association_user_preferences AS PERMISSIVE FOR SELECT TO authenticated USING (((user_id = ( SELECT auth.uid() AS uid)) AND private.is_association_member(association_id)));

CREATE POLICY association_prefs_update ON public.association_user_preferences AS PERMISSIVE FOR UPDATE TO authenticated USING (((user_id = ( SELECT auth.uid() AS uid)) AND private.is_association_member(association_id))) WITH CHECK (((user_id = ( SELECT auth.uid() AS uid)) AND private.is_association_member(association_id)));

CREATE POLICY associations_manager_update ON public.associations AS PERMISSIVE FOR UPDATE TO authenticated USING (private.is_association_manager(id)) WITH CHECK (private.is_association_manager(id));

CREATE POLICY associations_select ON public.associations AS PERMISSIVE FOR SELECT TO authenticated USING (private.can_view_association(id));

CREATE POLICY chat_select ON public.chat_messages AS PERMISSIVE FOR SELECT TO authenticated USING (private.can_view_association(association_id));

CREATE POLICY chat_read_insert ON public.chat_read_states AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (((user_id = ( SELECT auth.uid() AS uid)) AND private.is_association_member(association_id)));

CREATE POLICY chat_read_select ON public.chat_read_states AS PERMISSIVE FOR SELECT TO authenticated USING (((user_id = ( SELECT auth.uid() AS uid)) AND private.can_view_association(association_id)));

CREATE POLICY chat_read_update ON public.chat_read_states AS PERMISSIVE FOR UPDATE TO authenticated USING (((user_id = ( SELECT auth.uid() AS uid)) AND private.is_association_member(association_id))) WITH CHECK (((user_id = ( SELECT auth.uid() AS uid)) AND private.is_association_member(association_id)));

CREATE POLICY attendance_select ON public.cycle_attendance AS PERMISSIVE FOR SELECT TO authenticated USING (private.can_view_association(association_id));

CREATE POLICY draw_eligible_select ON public.draw_eligible_shares AS PERMISSIVE FOR SELECT TO authenticated USING (private.can_view_association(association_id));

CREATE POLICY draws_select ON public.draws AS PERMISSIVE FOR SELECT TO authenticated USING (private.can_view_association(association_id));

CREATE POLICY obligations_select ON public.installment_obligations AS PERMISSIVE FOR SELECT TO authenticated USING ((private.is_association_manager(association_id) OR private.owns_membership(membership_id, association_id)));

CREATE POLICY periods_select ON public.installment_periods AS PERMISSIVE FOR SELECT TO authenticated USING (private.can_view_association(association_id));

CREATE POLICY receipts_select ON public.installment_receipts AS PERMISSIVE FOR SELECT TO authenticated USING ((private.is_association_manager(association_id) OR private.owns_membership(membership_id, association_id)));

CREATE POLICY invitations_manager_select ON public.invitations AS PERMISSIVE FOR SELECT TO authenticated USING (private.is_association_manager(association_id));

CREATE POLICY notifications_select ON public.notifications AS PERMISSIVE FOR SELECT TO authenticated USING ((user_id = ( SELECT auth.uid() AS uid)));

CREATE POLICY notifications_update ON public.notifications AS PERMISSIVE FOR UPDATE TO authenticated USING ((user_id = ( SELECT auth.uid() AS uid))) WITH CHECK ((user_id = ( SELECT auth.uid() AS uid)));

CREATE POLICY profile_private_select ON public.profile_private AS PERMISSIVE FOR SELECT TO authenticated USING ((user_id = ( SELECT auth.uid() AS uid)));

CREATE POLICY profile_private_update ON public.profile_private AS PERMISSIVE FOR UPDATE TO authenticated USING ((user_id = ( SELECT auth.uid() AS uid))) WITH CHECK ((user_id = ( SELECT auth.uid() AS uid)));

CREATE POLICY profiles_select ON public.profiles AS PERMISSIVE FOR SELECT TO authenticated USING (((id = ( SELECT auth.uid() AS uid)) OR private.can_view_profile(id)));

CREATE POLICY profiles_update ON public.profiles AS PERMISSIVE FOR UPDATE TO authenticated USING ((id = ( SELECT auth.uid() AS uid))) WITH CHECK ((id = ( SELECT auth.uid() AS uid)));

CREATE POLICY corrections_manager_select ON public.receipt_corrections AS PERMISSIVE FOR SELECT TO authenticated USING (private.is_association_manager(association_id));

CREATE POLICY reminders_manager_select ON public.reminders AS PERMISSIVE FOR SELECT TO authenticated USING (private.is_association_manager(association_id));

CREATE POLICY shares_select ON public.shares AS PERMISSIVE FOR SELECT TO authenticated USING (private.can_view_association(association_id));

CREATE POLICY user_preferences_owner ON public.user_preferences AS PERMISSIVE FOR ALL TO authenticated USING ((user_id = ( SELECT auth.uid() AS uid))) WITH CHECK ((user_id = ( SELECT auth.uid() AS uid)));

ALTER TABLE public.association_cycles ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.association_events ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.association_memberships ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.association_notification_settings ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.association_user_preferences ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.associations ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.chat_read_states ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.cycle_attendance ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.draw_eligible_shares ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.draws ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.installment_obligations ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.installment_periods ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.installment_receipts ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.invitations ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.profile_private ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.receipt_corrections ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.reminders ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.shares ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.user_preferences ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER sahm_on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION private.handle_new_user();

CREATE TRIGGER association_events_append_only BEFORE DELETE OR UPDATE ON association_events FOR EACH ROW EXECUTE FUNCTION private.guard_append_only_history();

CREATE TRIGGER chat_messages_append_only BEFORE DELETE OR UPDATE ON chat_messages FOR EACH ROW EXECUTE FUNCTION private.guard_append_only_history();

CREATE TRIGGER draw_eligible_shares_append_only BEFORE DELETE OR UPDATE ON draw_eligible_shares FOR EACH ROW EXECUTE FUNCTION private.guard_append_only_history();

CREATE TRIGGER draws_append_only BEFORE DELETE OR UPDATE ON draws FOR EACH ROW EXECUTE FUNCTION private.guard_append_only_history();

CREATE TRIGGER installment_receipts_history_guard BEFORE DELETE OR UPDATE ON installment_receipts FOR EACH ROW EXECUTE FUNCTION private.guard_append_only_history();

CREATE TRIGGER receipt_corrections_append_only BEFORE DELETE OR UPDATE ON receipt_corrections FOR EACH ROW EXECUTE FUNCTION private.guard_append_only_history();

CREATE TRIGGER reminders_append_only BEFORE DELETE OR UPDATE ON reminders FOR EACH ROW EXECUTE FUNCTION private.guard_append_only_history();

CREATE EVENT TRIGGER ensure_rls ON ddl_command_end WHEN TAG IN ('CREATE TABLE','CREATE TABLE AS','SELECT INTO') EXECUTE FUNCTION public.rls_auto_enable();

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon,authenticated; GRANT SELECT ON ALL TABLES IN SCHEMA public TO authenticated; GRANT UPDATE(full_name) ON public.profiles TO authenticated; GRANT UPDATE(city) ON public.profile_private TO authenticated; GRANT INSERT,UPDATE ON public.user_preferences,public.association_user_preferences,public.chat_read_states TO authenticated; GRANT UPDATE(read_at) ON public.notifications TO authenticated;

REVOKE ALL ON FUNCTION public.rls_auto_enable() FROM PUBLIC,anon,authenticated; REVOKE ALL ON FUNCTION private.normalize_phone_e164(text),private.handle_new_user(),private.guard_append_only_history() FROM PUBLIC,anon,authenticated;

REVOKE ALL ON FUNCTION private.create_association(jsonb),private.create_invitation(uuid,text,text,integer),private.accept_invitation(text),private.record_installment_receipt(uuid),private.correct_installment_receipt(uuid,text),private.perform_draw(uuid,integer),private.send_chat_message(uuid,text),private.set_cycle_attendance(uuid,uuid,boolean),private.set_association_notification_types(uuid,text[]),private.set_association_user_preferences(uuid,boolean,boolean),private.send_installment_reminders(uuid,integer,uuid),private.mark_my_notification_read(uuid),private.is_association_manager(uuid),private.is_association_member(uuid),private.owns_membership(uuid,uuid),private.can_view_association(uuid),private.can_view_profile(uuid),private.can_view_event(uuid,text) FROM PUBLIC,anon; GRANT EXECUTE ON FUNCTION private.create_association(jsonb),private.create_invitation(uuid,text,text,integer),private.accept_invitation(text),private.record_installment_receipt(uuid),private.correct_installment_receipt(uuid,text),private.perform_draw(uuid,integer),private.send_chat_message(uuid,text),private.set_cycle_attendance(uuid,uuid,boolean),private.set_association_notification_types(uuid,text[]),private.set_association_user_preferences(uuid,boolean,boolean),private.send_installment_reminders(uuid,integer,uuid),private.mark_my_notification_read(uuid),private.is_association_manager(uuid),private.is_association_member(uuid),private.owns_membership(uuid,uuid),private.can_view_association(uuid),private.can_view_profile(uuid),private.can_view_event(uuid,text) TO authenticated;

REVOKE ALL ON FUNCTION public.create_association(jsonb),public.create_invitation(uuid,text,text,integer),public.accept_invitation(text),public.record_installment_receipt(uuid),public.correct_installment_receipt(uuid,text),public.perform_draw(uuid,integer),public.send_chat_message(uuid,text),public.set_cycle_attendance(uuid,uuid,boolean),public.set_association_notification_types(uuid,text[]),public.set_association_user_preferences(uuid,boolean,boolean),public.send_installment_reminders(uuid,integer,uuid),public.mark_my_notification_read(uuid) FROM PUBLIC,anon; GRANT EXECUTE ON FUNCTION public.create_association(jsonb),public.create_invitation(uuid,text,text,integer),public.accept_invitation(text),public.record_installment_receipt(uuid),public.correct_installment_receipt(uuid,text),public.perform_draw(uuid,integer),public.send_chat_message(uuid,text),public.set_cycle_attendance(uuid,uuid,boolean),public.set_association_notification_types(uuid,text[]),public.set_association_user_preferences(uuid,boolean,boolean),public.send_installment_reminders(uuid,integer,uuid),public.mark_my_notification_read(uuid) TO authenticated;

DO $do$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='chat_messages') THEN ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_messages; END IF; END $do$;
