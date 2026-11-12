export type QueueStatus = "waiting" | "serving" | "completed" | "cancelled" | "no_show";

export type Shop = {
  id: string;
  slug: string;
  name: string;
  barber_name: string;
  avg_cut_minutes: number;
  is_open: boolean;
  archived_at: string | null;
  created_at: string;
};

export type QueueEntry = {
  whatsapp_consent: boolean;
  cancel_token_hash: string | null;
  id: string;
  shop_id: string;
  customer_name: string;
  customer_phone: string;
  position: number;
  status: QueueStatus;
  notified_turn: boolean;
  notified_upcoming: boolean;
  created_at: string;
  updated_at: string;
};

export type PublicQueueEntry = Omit<QueueEntry, "customer_phone" | "cancel_token_hash" | "whatsapp_consent">;
export const PUBLIC_QUEUE_COLUMNS =
  "id,shop_id,customer_name,position,status,notified_turn,notified_upcoming,created_at,updated_at" as const;

export type WhatsAppSession = {
  shop_id: string;
  key_id: string;
  data: string;
  updated_at: string;
};

export type WhatsAppOutbox = {
  id: string; shop_id: string; entry_id: string; kind: "welcome" | "chair" | "progress" | "upcoming";
  phone: string; body: string; status: "pending" | "sending" | "sent" | "superseded";
  attempts: number; next_attempt_at: string; leased_until: string | null; sent_at: string | null; created_at: string;
  message_id: string | null; delivered_at: string | null;
};

export type BarberAccount = {
  shop_id: string;
  name: string;
  name_key: string;
  pin_hash: string;
  pin_fingerprint: string;
  created_at: string;
};

export type Database = {
  public: {
    Tables: {
      shops: {
        Row: Shop;
        Insert: Pick<Shop, "slug" | "name" | "barber_name"> &
          Partial<Omit<Shop, "slug" | "name" | "barber_name">>;
        Update: Partial<Shop>;
        Relationships: [];
      };
      queue_entries: {
        Row: QueueEntry;
        Insert: Pick<QueueEntry, "shop_id" | "customer_name" | "customer_phone"> &
          Partial<Omit<QueueEntry, "shop_id" | "customer_name" | "customer_phone" | "position">> &
          { position?: never };
        Update: Partial<Omit<QueueEntry, "position">> & { position?: never };
        Relationships: [{
          foreignKeyName: "queue_entries_shop_id_fkey";
          columns: ["shop_id"];
          isOneToOne: false;
          referencedRelation: "shops";
          referencedColumns: ["id"];
        }];
      };
      whatsapp_sessions: {
        Row: WhatsAppSession;
        Insert: Omit<WhatsAppSession, "updated_at"> & { updated_at?: string };
        Update: Partial<WhatsAppSession>;
        Relationships: [{
          foreignKeyName: "whatsapp_sessions_shop_id_fkey";
          columns: ["shop_id"];
          isOneToOne: false;
          referencedRelation: "shops";
          referencedColumns: ["id"];
        }];
      };
      whatsapp_outbox: {
        Row: WhatsAppOutbox;
        Insert: Pick<WhatsAppOutbox, "shop_id" | "entry_id" | "kind" | "phone" | "body"> & Partial<Omit<WhatsAppOutbox, "shop_id" | "entry_id" | "kind" | "phone" | "body">>;
        Update: Partial<WhatsAppOutbox>;
        Relationships: [];
      };
      barber_accounts: {
        Row: BarberAccount;
        Insert: Pick<BarberAccount, "shop_id" | "name" | "pin_hash" | "pin_fingerprint"> & Partial<Pick<BarberAccount, "created_at">>;
        Update: Partial<Pick<BarberAccount, "name" | "pin_hash" | "pin_fingerprint">>;
        Relationships: [{ foreignKeyName: "barber_accounts_shop_id_fkey"; columns: ["shop_id"]; isOneToOne: true; referencedRelation: "shops"; referencedColumns: ["id"] }];
      };
    };
    Views: { [_ in never]: never };
    Functions: {
      join_queue_consent: { Args: { p_shop: string; p_name: string; p_phone: string; p_token_hash: string; p_consent: boolean }; Returns: QueueEntry };
      join_queue: { Args: { p_shop: string; p_name: string; p_phone: string; p_token_hash: string }; Returns: QueueEntry };
      advance_queue: { Args: { p_shop: string; p_expected_serving: string | null; p_expected_waiting: string | null; p_finish: string }; Returns: { serving: QueueEntry | null; upcoming: QueueEntry | null } };
      cancel_queue: { Args: { p_shop: string; p_id: string; p_token_hash: string }; Returns: undefined };
      cancel_queue_phone: { Args: { p_shop: string; p_phone: string }; Returns: undefined };
      skip_queue: { Args: { p_shop: string; p_id: string }; Returns: undefined };
      create_barber_shop: { Args: { p_parent_shop: string; p_name: string; p_pin_hash: string; p_pin_fingerprint: string }; Returns: { id: string; name: string } };
      cancel_queue_phone_all: { Args: { p_phone: string }; Returns: number };
      update_barber_account: { Args: { p_shop: string; p_name: string; p_pin_hash: string | null; p_pin_fingerprint: string | null }; Returns: { id: string; name: string } };
      archive_barber_account: { Args: { p_shop: string; p_primary_shop: string }; Returns: undefined };
      cancel_queue_phone_details: { Args: { p_phone: string }; Returns: string[] };
      claim_whatsapp_outbox: { Args: { p_limit?: number }; Returns: WhatsAppOutbox[] };
      finish_whatsapp_outbox: { Args: { p_id: string; p_success: boolean }; Returns: undefined };
      claim_whatsapp_deliveries: { Args: { p_shops: string[]; p_limit?: number }; Returns: WhatsAppOutbox[] };
      finish_whatsapp_attempt: { Args: { p_id: string; p_message_id: string; p_success: boolean }; Returns: undefined };
      confirm_whatsapp_delivery: { Args: { p_shop: string; p_message_id: string }; Returns: undefined };
    };
    Enums: { [_ in never]: never };
    CompositeTypes: { [_ in never]: never };
  };
};
