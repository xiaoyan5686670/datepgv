--
-- PostgreSQL database dump
--

\restrict xudHTEYlbZ6M8EoP2k9O6M7DQxAfdWlZXjxnYUUkCdZXTssguJYnBUiFdj1Hett

-- Dumped from database version 15.17
-- Dumped by pg_dump version 15.17

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: vector; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA public;


--
-- Name: EXTENSION vector; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION vector IS 'vector data type and ivfflat and hnsw access methods';


--
-- Name: update_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: analytics_db_connections; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.analytics_db_connections (
    id integer NOT NULL,
    name character varying(128) NOT NULL,
    engine character varying(20) NOT NULL,
    url text NOT NULL,
    is_default boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT analytics_db_connections_engine_check CHECK (((engine)::text = ANY ((ARRAY['postgresql'::character varying, 'mysql'::character varying])::text[])))
);


--
-- Name: analytics_db_connections_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.analytics_db_connections_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: analytics_db_connections_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.analytics_db_connections_id_seq OWNED BY public.analytics_db_connections.id;


--
-- Name: app_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_settings (
    key text NOT NULL,
    value text NOT NULL
);


--
-- Name: chat_messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.chat_messages (
    id integer NOT NULL,
    session_id character varying(64) NOT NULL,
    role character varying(20) NOT NULL,
    content text NOT NULL,
    sql_type character varying(20),
    created_at timestamp with time zone DEFAULT now(),
    generated_sql text,
    executed boolean,
    exec_error text,
    result_preview jsonb,
    elapsed_ms integer,
    decision_trace jsonb,
    CONSTRAINT chat_messages_role_check CHECK (((role)::text = ANY ((ARRAY['user'::character varying, 'assistant'::character varying, 'system'::character varying])::text[])))
);


--
-- Name: chat_messages_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.chat_messages_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: chat_messages_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.chat_messages_id_seq OWNED BY public.chat_messages.id;


--
-- Name: chat_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.chat_sessions (
    id integer NOT NULL,
    session_id character varying(64) NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    user_id integer NOT NULL
);


--
-- Name: chat_sessions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.chat_sessions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: chat_sessions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.chat_sessions_id_seq OWNED BY public.chat_sessions.id;


--
-- Name: data_scope_policies; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.data_scope_policies (
    id integer NOT NULL,
    subject_type character varying(20) NOT NULL,
    subject_key character varying(120) NOT NULL,
    dimension character varying(32) NOT NULL,
    allowed_values jsonb DEFAULT '[]'::jsonb NOT NULL,
    deny_values jsonb DEFAULT '[]'::jsonb NOT NULL,
    merge_mode character varying(16) DEFAULT 'union'::character varying NOT NULL,
    priority integer DEFAULT 100 NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    note text,
    updated_by character varying(100),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: data_scope_policies_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.data_scope_policies_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: data_scope_policies_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.data_scope_policies_id_seq OWNED BY public.data_scope_policies.id;


--
-- Name: llm_configs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.llm_configs (
    id integer NOT NULL,
    name character varying(100) NOT NULL,
    config_type character varying(20) NOT NULL,
    model character varying(200) NOT NULL,
    api_key text,
    api_base character varying(500),
    extra_params jsonb DEFAULT '{}'::jsonb NOT NULL,
    is_active boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT llm_configs_config_type_check CHECK (((config_type)::text = ANY ((ARRAY['llm'::character varying, 'embedding'::character varying])::text[])))
);


--
-- Name: llm_configs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.llm_configs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: llm_configs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.llm_configs_id_seq OWNED BY public.llm_configs.id;


--
-- Name: login_audit; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.login_audit (
    id integer NOT NULL,
    user_id integer NOT NULL,
    login_method character varying(32) NOT NULL,
    client_ip character varying(128),
    user_agent character varying(512),
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: login_audit_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.login_audit_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: login_audit_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.login_audit_id_seq OWNED BY public.login_audit.id;


--
-- Name: org_hierarchy_users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.org_hierarchy_users (
    id integer NOT NULL,
    name character varying(100) NOT NULL,
    role character varying(50) NOT NULL,
    parent_id integer,
    path text NOT NULL,
    CONSTRAINT ck_org_hierarchy_users_path_slash_wrapped CHECK (((path ~~ '/%'::text) AND (path ~~ '%/'::text)))
);


--
-- Name: org_hierarchy_users_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.org_hierarchy_users_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: org_hierarchy_users_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.org_hierarchy_users_id_seq OWNED BY public.org_hierarchy_users.id;


--
-- Name: province_aliases; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.province_aliases (
    id integer NOT NULL,
    canonical_name character varying(50) NOT NULL,
    alias character varying(50) NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    priority integer DEFAULT 100 NOT NULL,
    updated_by character varying(100),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: province_aliases_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.province_aliases_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: province_aliases_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.province_aliases_id_seq OWNED BY public.province_aliases.id;


--
-- Name: rag_chunks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.rag_chunks (
    id bigint NOT NULL,
    content text NOT NULL,
    embedding public.vector(1024),
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    hierarchy_path jsonb DEFAULT '[]'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chk_rag_chunks_hierarchy_path_is_array CHECK ((jsonb_typeof(hierarchy_path) = 'array'::text)),
    CONSTRAINT chk_rag_chunks_metadata_hierarchy_path CHECK (((NOT (metadata ? 'hierarchy_path'::text)) OR (jsonb_typeof((metadata -> 'hierarchy_path'::text)) = 'array'::text)))
);


--
-- Name: TABLE rag_chunks; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.rag_chunks IS 'RAG text chunks; hierarchy_path mirrors metadata.hierarchy_path for indexing';


--
-- Name: COLUMN rag_chunks.hierarchy_path; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.rag_chunks.hierarchy_path IS 'JSON array of org path segments, e.g. ["北部大区","山西省","张三"]';


--
-- Name: rag_chunks_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.rag_chunks_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: rag_chunks_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.rag_chunks_id_seq OWNED BY public.rag_chunks.id;


--
-- Name: roles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.roles (
    id integer NOT NULL,
    name character varying(50) NOT NULL,
    description character varying(255),
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: roles_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.roles_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: roles_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.roles_id_seq OWNED BY public.roles.id;


--
-- Name: sales_summary; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sales_summary (
    summary_date date NOT NULL,
    department character varying(100) NOT NULL,
    total_amount numeric(14,2) NOT NULL,
    order_count integer NOT NULL,
    avg_amount numeric(14,2)
);


--
-- Name: sql_skills; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sql_skills (
    id integer NOT NULL,
    name character varying(80) NOT NULL,
    description character varying(300) NOT NULL,
    content text NOT NULL,
    keywords jsonb DEFAULT '[]'::jsonb NOT NULL,
    sql_types jsonb DEFAULT '[]'::jsonb NOT NULL,
    priority integer DEFAULT 100 NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    updated_by character varying(100),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: sql_skills_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.sql_skills_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: sql_skills_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.sql_skills_id_seq OWNED BY public.sql_skills.id;


--
-- Name: table_metadata; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.table_metadata (
    id integer NOT NULL,
    db_type character varying(20) NOT NULL,
    database_name character varying(200),
    schema_name character varying(200),
    table_name character varying(200) NOT NULL,
    table_comment text,
    columns jsonb DEFAULT '[]'::jsonb NOT NULL,
    sample_data jsonb,
    tags text[],
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    embedding public.vector(1024),
    CONSTRAINT db_type_check CHECK (((db_type)::text = ANY ((ARRAY['hive'::character varying, 'postgresql'::character varying, 'oracle'::character varying, 'mysql'::character varying])::text[])))
);


--
-- Name: table_metadata_edges; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.table_metadata_edges (
    id integer NOT NULL,
    from_metadata_id integer NOT NULL,
    to_metadata_id integer NOT NULL,
    relation_type character varying(32) NOT NULL,
    from_column character varying(200),
    to_column character varying(200),
    note text,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT table_metadata_edges_check CHECK ((from_metadata_id <> to_metadata_id)),
    CONSTRAINT table_metadata_edges_relation_type_check CHECK (((relation_type)::text = ANY ((ARRAY['foreign_key'::character varying, 'logical'::character varying, 'coquery'::character varying])::text[])))
);


--
-- Name: table_metadata_edges_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.table_metadata_edges_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: table_metadata_edges_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.table_metadata_edges_id_seq OWNED BY public.table_metadata_edges.id;


--
-- Name: table_metadata_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.table_metadata_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: table_metadata_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.table_metadata_id_seq OWNED BY public.table_metadata.id;


--
-- Name: user_roles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_roles (
    user_id integer NOT NULL,
    role_id integer NOT NULL
);


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id integer NOT NULL,
    username character varying(100) NOT NULL,
    password_hash text NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    province character varying(50),
    employee_level character varying(20) DEFAULT 'staff'::character varying NOT NULL,
    district character varying(100),
    full_name character varying(100),
    org_region character varying(100),
    rag_permission_override jsonb,
    avatar_data text
);


--
-- Name: COLUMN users.org_region; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.users.org_region IS '大区(daqua)，来自业务经理通讯录同步';


--
-- Name: COLUMN users.rag_permission_override; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.users.rag_permission_override IS 'Admin RAG ABAC override JSON; NULL means auto from org CSV';


--
-- Name: users_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.users_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: users_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.users_id_seq OWNED BY public.users.id;


--
-- Name: analytics_db_connections id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.analytics_db_connections ALTER COLUMN id SET DEFAULT nextval('public.analytics_db_connections_id_seq'::regclass);


--
-- Name: chat_messages id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_messages ALTER COLUMN id SET DEFAULT nextval('public.chat_messages_id_seq'::regclass);


--
-- Name: chat_sessions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_sessions ALTER COLUMN id SET DEFAULT nextval('public.chat_sessions_id_seq'::regclass);


--
-- Name: data_scope_policies id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.data_scope_policies ALTER COLUMN id SET DEFAULT nextval('public.data_scope_policies_id_seq'::regclass);


--
-- Name: llm_configs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.llm_configs ALTER COLUMN id SET DEFAULT nextval('public.llm_configs_id_seq'::regclass);


--
-- Name: login_audit id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.login_audit ALTER COLUMN id SET DEFAULT nextval('public.login_audit_id_seq'::regclass);


--
-- Name: org_hierarchy_users id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.org_hierarchy_users ALTER COLUMN id SET DEFAULT nextval('public.org_hierarchy_users_id_seq'::regclass);


--
-- Name: province_aliases id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.province_aliases ALTER COLUMN id SET DEFAULT nextval('public.province_aliases_id_seq'::regclass);


--
-- Name: rag_chunks id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rag_chunks ALTER COLUMN id SET DEFAULT nextval('public.rag_chunks_id_seq'::regclass);


--
-- Name: roles id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.roles ALTER COLUMN id SET DEFAULT nextval('public.roles_id_seq'::regclass);


--
-- Name: sql_skills id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sql_skills ALTER COLUMN id SET DEFAULT nextval('public.sql_skills_id_seq'::regclass);


--
-- Name: table_metadata id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.table_metadata ALTER COLUMN id SET DEFAULT nextval('public.table_metadata_id_seq'::regclass);


--
-- Name: table_metadata_edges id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.table_metadata_edges ALTER COLUMN id SET DEFAULT nextval('public.table_metadata_edges_id_seq'::regclass);


--
-- Name: users id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users ALTER COLUMN id SET DEFAULT nextval('public.users_id_seq'::regclass);


--
-- Name: analytics_db_connections analytics_db_connections_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.analytics_db_connections
    ADD CONSTRAINT analytics_db_connections_pkey PRIMARY KEY (id);


--
-- Name: app_settings app_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_settings
    ADD CONSTRAINT app_settings_pkey PRIMARY KEY (key);


--
-- Name: chat_messages chat_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_messages
    ADD CONSTRAINT chat_messages_pkey PRIMARY KEY (id);


--
-- Name: chat_sessions chat_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_sessions
    ADD CONSTRAINT chat_sessions_pkey PRIMARY KEY (id);


--
-- Name: chat_sessions chat_sessions_session_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_sessions
    ADD CONSTRAINT chat_sessions_session_id_key UNIQUE (session_id);


--
-- Name: data_scope_policies data_scope_policies_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.data_scope_policies
    ADD CONSTRAINT data_scope_policies_pkey PRIMARY KEY (id);


--
-- Name: llm_configs llm_configs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.llm_configs
    ADD CONSTRAINT llm_configs_pkey PRIMARY KEY (id);


--
-- Name: login_audit login_audit_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.login_audit
    ADD CONSTRAINT login_audit_pkey PRIMARY KEY (id);


--
-- Name: org_hierarchy_users org_hierarchy_users_path_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.org_hierarchy_users
    ADD CONSTRAINT org_hierarchy_users_path_key UNIQUE (path);


--
-- Name: org_hierarchy_users org_hierarchy_users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.org_hierarchy_users
    ADD CONSTRAINT org_hierarchy_users_pkey PRIMARY KEY (id);


--
-- Name: province_aliases province_aliases_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.province_aliases
    ADD CONSTRAINT province_aliases_pkey PRIMARY KEY (id);


--
-- Name: rag_chunks rag_chunks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rag_chunks
    ADD CONSTRAINT rag_chunks_pkey PRIMARY KEY (id);


--
-- Name: roles roles_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.roles
    ADD CONSTRAINT roles_name_key UNIQUE (name);


--
-- Name: roles roles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.roles
    ADD CONSTRAINT roles_pkey PRIMARY KEY (id);


--
-- Name: sql_skills sql_skills_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sql_skills
    ADD CONSTRAINT sql_skills_name_key UNIQUE (name);


--
-- Name: sql_skills sql_skills_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sql_skills
    ADD CONSTRAINT sql_skills_pkey PRIMARY KEY (id);


--
-- Name: table_metadata_edges table_metadata_edges_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.table_metadata_edges
    ADD CONSTRAINT table_metadata_edges_pkey PRIMARY KEY (id);


--
-- Name: table_metadata_edges table_metadata_edges_unique_triple; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.table_metadata_edges
    ADD CONSTRAINT table_metadata_edges_unique_triple UNIQUE (from_metadata_id, to_metadata_id, relation_type);


--
-- Name: table_metadata table_metadata_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.table_metadata
    ADD CONSTRAINT table_metadata_pkey PRIMARY KEY (id);


--
-- Name: data_scope_policies uq_data_scope_policy_subject_dimension; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.data_scope_policies
    ADD CONSTRAINT uq_data_scope_policy_subject_dimension UNIQUE (subject_type, subject_key, dimension);


--
-- Name: province_aliases uq_province_alias_alias; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.province_aliases
    ADD CONSTRAINT uq_province_alias_alias UNIQUE (alias);


--
-- Name: user_roles user_roles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_roles
    ADD CONSTRAINT user_roles_pkey PRIMARY KEY (user_id, role_id);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: users users_username_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_username_key UNIQUE (username);


--
-- Name: analytics_db_conn_one_default_mysql; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX analytics_db_conn_one_default_mysql ON public.analytics_db_connections USING btree (engine) WHERE (is_default AND ((engine)::text = 'mysql'::text));


--
-- Name: analytics_db_conn_one_default_pg; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX analytics_db_conn_one_default_pg ON public.analytics_db_connections USING btree (engine) WHERE (is_default AND ((engine)::text = 'postgresql'::text));


--
-- Name: chat_messages_decision_trace_gin; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX chat_messages_decision_trace_gin ON public.chat_messages USING gin (decision_trace);


--
-- Name: chat_messages_role_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX chat_messages_role_created_at_idx ON public.chat_messages USING btree (role, created_at DESC);


--
-- Name: chat_messages_session_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX chat_messages_session_idx ON public.chat_messages USING btree (session_id, created_at);


--
-- Name: chat_sessions_user_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX chat_sessions_user_id_idx ON public.chat_sessions USING btree (user_id);


--
-- Name: idx_data_scope_policies_dim_enabled; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_data_scope_policies_dim_enabled ON public.data_scope_policies USING btree (dimension, enabled);


--
-- Name: idx_data_scope_policies_subject; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_data_scope_policies_subject ON public.data_scope_policies USING btree (subject_type, subject_key);


--
-- Name: idx_province_aliases_canonical_enabled; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_province_aliases_canonical_enabled ON public.province_aliases USING btree (canonical_name, enabled);


--
-- Name: idx_province_aliases_enabled_priority; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_province_aliases_enabled_priority ON public.province_aliases USING btree (enabled, priority, id);


--
-- Name: idx_sql_skills_enabled_priority; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sql_skills_enabled_priority ON public.sql_skills USING btree (enabled, priority, id);


--
-- Name: idx_users_employee_level; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_employee_level ON public.users USING btree (employee_level);


--
-- Name: idx_users_province; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_province ON public.users USING btree (province);


--
-- Name: ix_org_hierarchy_users_parent_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_org_hierarchy_users_parent_id ON public.org_hierarchy_users USING btree (parent_id);


--
-- Name: ix_org_hierarchy_users_path_prefix; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_org_hierarchy_users_path_prefix ON public.org_hierarchy_users USING btree (path text_pattern_ops);


--
-- Name: ix_org_hierarchy_users_role; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_org_hierarchy_users_role ON public.org_hierarchy_users USING btree (role);


--
-- Name: login_audit_user_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX login_audit_user_created_idx ON public.login_audit USING btree (user_id, created_at DESC);


--
-- Name: rag_chunks_embedding_ivfflat_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX rag_chunks_embedding_ivfflat_idx ON public.rag_chunks USING ivfflat (embedding public.vector_cosine_ops) WITH (lists='50');


--
-- Name: rag_chunks_hierarchy_path_gin; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX rag_chunks_hierarchy_path_gin ON public.rag_chunks USING gin (hierarchy_path jsonb_path_ops);


--
-- Name: table_metadata_edges_endpoints_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX table_metadata_edges_endpoints_idx ON public.table_metadata_edges USING btree (from_metadata_id, to_metadata_id);


--
-- Name: table_metadata_edges_from_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX table_metadata_edges_from_idx ON public.table_metadata_edges USING btree (from_metadata_id);


--
-- Name: table_metadata_edges_to_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX table_metadata_edges_to_idx ON public.table_metadata_edges USING btree (to_metadata_id);


--
-- Name: table_metadata_embedding_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX table_metadata_embedding_idx ON public.table_metadata USING ivfflat (embedding public.vector_cosine_ops) WITH (lists='100');


--
-- Name: table_metadata_name_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX table_metadata_name_idx ON public.table_metadata USING btree (db_type, database_name, table_name);


--
-- Name: user_roles_role_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX user_roles_role_id_idx ON public.user_roles USING btree (role_id);


--
-- Name: users users_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER users_updated_at BEFORE UPDATE ON public.users FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: chat_messages chat_messages_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_messages
    ADD CONSTRAINT chat_messages_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.chat_sessions(session_id) ON DELETE CASCADE;


--
-- Name: chat_sessions chat_sessions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_sessions
    ADD CONSTRAINT chat_sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: login_audit login_audit_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.login_audit
    ADD CONSTRAINT login_audit_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: org_hierarchy_users org_hierarchy_users_parent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.org_hierarchy_users
    ADD CONSTRAINT org_hierarchy_users_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES public.org_hierarchy_users(id) ON DELETE RESTRICT;


--
-- Name: table_metadata_edges table_metadata_edges_from_metadata_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.table_metadata_edges
    ADD CONSTRAINT table_metadata_edges_from_metadata_id_fkey FOREIGN KEY (from_metadata_id) REFERENCES public.table_metadata(id) ON DELETE CASCADE;


--
-- Name: table_metadata_edges table_metadata_edges_to_metadata_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.table_metadata_edges
    ADD CONSTRAINT table_metadata_edges_to_metadata_id_fkey FOREIGN KEY (to_metadata_id) REFERENCES public.table_metadata(id) ON DELETE CASCADE;


--
-- Name: user_roles user_roles_role_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_roles
    ADD CONSTRAINT user_roles_role_id_fkey FOREIGN KEY (role_id) REFERENCES public.roles(id) ON DELETE CASCADE;


--
-- Name: user_roles user_roles_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_roles
    ADD CONSTRAINT user_roles_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--

\unrestrict xudHTEYlbZ6M8EoP2k9O6M7DQxAfdWlZXjxnYUUkCdZXTssguJYnBUiFdj1Hett

