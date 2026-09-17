# Di Tiglio Barber Club

Site de agendamento em HTML/CSS/JS puro, hospedado no GitHub Pages, com Supabase como banco, autenticação e API. Não há build, não há `npm`, não há pastas `src` ou `public` — os arquivos do site ficam todos na raiz do repositório.

## O que existe hoje

Cliente entra com e-mail e senha, escolhe **o serviço primeiro**, depois o profissional, a data e o horário. A agenda só mostra encaixes que cabem de verdade: cada serviço tem a própria duração, o intervalo de almoço fica bloqueado, folgas fecham o dia inteiro e nenhum horário se sobrepõe a outro atendimento. O cliente cancela e remarca sozinho pela conta dele; o barbeiro desmarca, remarca e marca folga pelo portal. No aniversário, o cliente ganha um cupom de desconto e uma mensagem de WhatsApp.

| Serviço | Duração | Preço inicial |
|---|---|---|
| Corte | 30 min | R$ 60,00 |
| Barba | 30 min | R$ 45,00 |
| Corte + Barba | 1 h | R$ 95,00 |
| Corte + Barba + Extra | 1 h 30 | R$ 130,00 |

Nomes, durações e preços são editáveis pelo painel administrativo — a tabela acima é só a carga inicial.

## Instalação

1. Crie um projeto em <https://supabase.com>.
2. **Se o seu projeto já tinha a versão anterior do site**, rode primeiro `reset.sql` no SQL Editor. Ele apaga as tabelas antigas de barbeiro e agendamento, que não têm as colunas novas (almoço, duração por serviço, cliente vinculado) e por isso não são aproveitáveis. As contas de login não são apagadas — só recadastre os barbeiros depois, pelo botão *Sou barbeiro*. Projeto novo em folha pode pular este passo.
3. Abra **SQL Editor**, cole todo o conteúdo de `schema.sql` e execute. Pode rodar de novo quantas vezes quiser.
4. Preencha `config.js` com a URL e a chave **publicável/anon** do projeto. Nunca coloque a chave `service_role` nesse arquivo.
5. Envie os arquivos da raiz para o repositório do GitHub.
6. Em **Settings → Pages**, escolha *Deploy from a branch*, branch `main`, pasta `/(root)`, e salve.
7. No Supabase, em **Authentication → URL Configuration**, coloque `https://SEU-USUARIO.github.io/NOME-DO-REPOSITORIO/` como Site URL e também em Redirect URLs.

### Conta do dono

Cadastre-se pelo botão **Sou barbeiro** e depois rode no SQL Editor:

```sql
update public.user_roles
set role = 'admin'
where user_id = (select id from auth.users where email = 'email-do-dono@exemplo.com');
```

Entre de novo e o portal vira o painel administrativo, com as abas Agenda, Equipe, Serviços, Planos e Configurações.

## Arquivos na raiz do repositório

```
app.js                      aplicação inteira
config.js                   URL e chave anon do Supabase
index.html                  página
styles.css                  identidade visual (azul, cinza e preto)
schema.sql                  banco, permissões e regras de agendamento
reset.sql                   limpeza da versão antiga (rodar antes, só na migração)
manifest.webmanifest        instalação como app no celular
sw.js                       cache offline dos arquivos do site
logo-ditiglio.png           logo azul (fundo claro)
ditiglio-logo-branca.png    logo branca (fundo escuro)
icon-512.png                ícone do app
README.md
```

A pasta `supabase/functions/` não faz parte do site: ela é publicada no Supabase, não no GitHub Pages.

## Pagamentos

O sinal de 40% já está calculado, gravado em cada agendamento e mostrado ao cliente, mas a **cobrança online está desligada**. Com ela desligada, o agendamento nasce `confirmado` e o valor do sinal aparece como combinado na barbearia.

Para ligar, marque *Cobrança online ativa* em Configurações (ou rode `update public.settings set payments_enabled = true where id = 1;`). A partir daí o agendamento nasce `aguardando sinal` e uma linha em `public.payments` é criada com o valor devido.

Falta então uma Edge Function que gere a cobrança no provedor (Mercado Pago, Asaas, Stripe) e um webhook que mude `payments.status` para `paid` e `appointments.status` para `confirmed`. O percentual do sinal fica em `settings.deposit_percent` — mudar de 40% para outro valor é uma edição no painel, não no código.

Planos funcionam do mesmo jeito: o pedido de assinatura já é gravado em `public.subscriptions` com status `pending` e o cliente é levado ao WhatsApp da barbearia. Quando o provedor entrar, é só a mesma função criar a recorrência e mudar o status para `active`.

## WhatsApp

Toda mensagem que o sistema precisa mandar vira uma linha em `public.message_queue`: confirmação, remarcação, cancelamento, lembrete de 24 h antes e aniversário. Quem esvazia a fila é a função `supabase/functions/whatsapp-dispatch`.

```bash
supabase functions deploy whatsapp-dispatch
supabase functions deploy daily-routines
supabase secrets set WHATSAPP_DRIVER=log
```

Com `WHATSAPP_DRIVER=log` nada é enviado — a mensagem é escrita no log da função, o que serve para conferir os textos antes de contratar um provedor. Para enviar de verdade, marque *Disparo automático de WhatsApp* em Configurações e troque o driver:

| Provedor | `WHATSAPP_DRIVER` | Segredos |
|---|---|---|
| Meta Cloud API (oficial) | `meta` | `META_PHONE_NUMBER_ID`, `META_ACCESS_TOKEN` |
| Z-API / Evolution (QR code) | `zapi` | `ZAPI_INSTANCE`, `ZAPI_TOKEN`, `ZAPI_CLIENT_TOKEN` |
| Twilio | `twilio` | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_WHATSAPP_FROM` |

Mensagem que falha é reagendada e tentada mais duas vezes antes de virar `failed`.

Observação sobre a Meta: fora da janela de 24 h desde a última mensagem do cliente, só é permitido enviar *template* aprovado. As mensagens de aniversário e de lembrete caem nesse caso, então cadastre-as como template na Meta antes de ligar o driver `meta`. Os drivers `zapi` e `twilio` não têm essa restrição da mesma forma.

### Agendamento das rotinas

No Supabase, em **Database → Cron** (extensão `pg_cron`):

```sql
-- esvazia a fila de WhatsApp a cada 5 minutos
select cron.schedule('whatsapp', '*/5 * * * *', $$
  select net.http_post(
    url := 'https://SEU-PROJETO.supabase.co/functions/v1/whatsapp-dispatch',
    headers := '{"Authorization": "Bearer SUA_SERVICE_ROLE_KEY"}'::jsonb) $$);

-- aniversários e lembretes, todo dia às 9h de Brasília (12h UTC)
select cron.schedule('rotinas-diarias', '0 12 * * *', $$
  select net.http_post(
    url := 'https://SEU-PROJETO.supabase.co/functions/v1/daily-routines',
    headers := '{"Authorization": "Bearer SUA_SERVICE_ROLE_KEY"}'::jsonb) $$);
```

## Regras de agendamento

Ficam todas no banco, não no navegador — quem chamar a API por fora continua esbarrando nelas.

- Horário precisa caber inteiro dentro do expediente do barbeiro.
- Horário que encosta no intervalo de almoço é recusado.
- Folga fecha o dia inteiro daquele barbeiro.
- Dois atendimentos nunca se sobrepõem (garantido por constraint no banco, não por checagem no código).
- Antecedência mínima padrão de 30 minutos.
- Cliente cancela até 2 horas antes; barbeiro e admin cancelam a qualquer momento.
- Cupom só vale para o dono dele, dentro da validade e uma única vez. Cancelou o agendamento, o cupom volta a valer.

Antecedência, prazo de cancelamento, intervalo entre horários, percentual do sinal e desconto de aniversário são todos editáveis em Configurações.

## Segurança

Row Level Security está ligada em todas as tabelas. Cliente enxerga apenas os próprios agendamentos, cupons, pagamentos e assinaturas; barbeiro enxerga a própria agenda; admin enxerga tudo. Agendamentos não podem ser inseridos direto pela API — só pelas funções `create_appointment`, `reschedule_appointment` e `cancel_appointment`, que validam tudo antes. A fila de WhatsApp e as rotinas diárias só rodam com a chave `service_role`, que fica nos segredos do Supabase e nunca no navegador.

Nunca envie para o GitHub: `env.local`, senhas ou a chave `service_role`.
