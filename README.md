# Di Tiglio — versão plana para GitHub Pages

Todos os arquivos deste pacote ficam na raiz do repositório. Não existem pastas `src`, `public` ou `.github`.

## Configuração

1. Crie um projeto gratuito em <https://supabase.com>.
2. Abra **SQL Editor**, cole todo o conteúdo de `schema.sql` e execute.
3. Abra o arquivo `config.js` e preencha a URL e a chave **publicável/anon** do Supabase.
4. Nunca coloque a chave `service_role` em `config.js`.
5. Envie todos os arquivos para a raiz do repositório GitHub.
6. Abra **Settings → Pages**.
7. Em **Source**, selecione **Deploy from a branch**.
8. Selecione a branch `main`, pasta `/(root)` e clique em **Save**.

## Conta do dono

Cadastre a conta do dono pelo botão **Sou barbeiro**. Depois execute no SQL Editor:

```sql
update public.user_roles
set role = 'admin'
where user_id = (
  select id from auth.users where email = 'email-do-dono@exemplo.com'
);
```

## Autenticação

No Supabase, abra **Authentication → URL Configuration** e use como Site URL:

`https://SEU-USUARIO.github.io/NOME-DO-REPOSITORIO/`

Adicione o mesmo endereço em Redirect URLs.

## Arquivos que devem aparecer no GitHub

```text
app.js
config.js
index.html
logo-ditiglio.png
manifest.webmanifest
README.md
schema.sql
styles.css
sw.js
```

Não envie `env.local`, senhas ou a chave `service_role`.
