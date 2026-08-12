# Deploy do App de Auditorias no Lightsail

Guia passo a passo para colocar o app no ar na instância `auditoria.trokservice.com.br` (IP `15.229.168.209`), usando o terminal SSH pelo próprio navegador do console AWS Lightsail (aba "Connect" da instância, botão "Connect using SSH").

Todos os comandos abaixo devem ser colados nesse terminal, um bloco de cada vez.

---

## Fase 0 — Descobrir o sistema operacional

```bash
cat /etc/os-release
```

Se aparecer `Ubuntu` ou `Debian`, siga o guia normalmente. Se aparecer `Amazon Linux`, troque `apt-get` por `dnf` nos comandos de instalação (`sudo dnf install -y ...`) — o resto é igual.

---

## Fase 1 — Instalar Node.js, Nginx e ferramentas

```bash
sudo apt-get update
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs nginx unzip build-essential python3
node -v
```

Deve mostrar algo como `v20.x.x`.

---

## Fase 2 — Enviar os arquivos do app

1. No topo da janela do terminal SSH do Lightsail, clique no ícone de **upload de arquivo** (nuvem com seta para cima).
2. Envie o arquivo `auditoria-lojas-deploy.zip` (está salvo em `G:\Meu Drive\APP TROK\CONFERENCIA ESTOQUE\auditoria-lojas-deploy.zip`).
3. Depois de enviado, ele cai na pasta pessoal (`/home/ubuntu` ou `/home/bitnami`, dependendo do blueprint). Rode:

```bash
mkdir -p ~/auditoria-lojas
unzip -o ~/auditoria-lojas-deploy.zip -d ~/auditoria-lojas
cd ~/auditoria-lojas
ls -la
```

Você deve ver `server.js`, `db.js`, `package.json`, a pasta `public/` (com o `index.html` do app) e `views/login.html`.

---

## Fase 3 — Configurar a senha e a chave secreta

```bash
cd ~/auditoria-lojas
cp .env.example .env
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Copie o texto longo que aparecer (a chave secreta) e depois edite o `.env`:

```bash
nano .env
```

Ajuste as linhas:
- `APP_PASSWORD=` → coloque a senha que a equipe vai usar para entrar no app.
- `SESSION_SECRET=` → cole a chave gerada no passo acima.
- deixe `COOKIE_SECURE=false` por enquanto (só muda para `true` na Fase 9, depois do HTTPS funcionar).

Salve com `Ctrl+O`, `Enter`, e saia com `Ctrl+X`.

---

## Fase 4 — Instalar dependências e testar

```bash
cd ~/auditoria-lojas
npm install
node server.js
```

Deve aparecer `Servidor de Auditorias rodando na porta 3000`. Deixe rodando, abra **outra aba** do terminal SSH (ou espere a Fase 5) e teste:

```bash
curl -I http://localhost:3000/login
```

Deve responder `HTTP/1.1 200 OK`. Volte à primeira aba e pare o teste com `Ctrl+C`.

---

## Fase 5 — Manter o servidor sempre rodando (PM2)

```bash
sudo npm install -g pm2
cd ~/auditoria-lojas
pm2 start server.js --name auditoria-lojas
pm2 save
pm2 startup
```

O último comando (`pm2 startup`) imprime uma linha começando com `sudo env PATH=...` — **copie essa linha exata e execute ela** (isso garante que o app volte a rodar sozinho se a instância reiniciar).

Para ver se está rodando: `pm2 status`. Para ver os logs: `pm2 logs auditoria-lojas`.

---

## Fase 6 — Nginx como proxy (porta 80 → app na porta 3000)

```bash
sudo tee /etc/nginx/sites-available/auditoria > /dev/null << 'EOF'
server {
    listen 80;
    server_name auditoria.trokservice.com.br;
    client_max_body_size 30M;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
EOF
sudo ln -sf /etc/nginx/sites-available/auditoria /etc/nginx/sites-enabled/auditoria
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl restart nginx
```

`client_max_body_size 30M` é importante: as visitas podem ter fotos anexadas (base64), e o limite padrão do Nginx (1MB) bloquearia o salvamento.

---

## Fase 7 — Liberar as portas no firewall do Lightsail

No **console da AWS** (não no terminal SSH):

1. Abra a instância → aba **Networking**.
2. Em **IPv4 Firewall**, clique **Add rule** e adicione: `HTTP` (porta 80) e `HTTPS` (porta 443), se ainda não existirem.
3. Role até **IPv6 Firewall** e adicione as mesmas regras (`HTTP` 80 e `HTTPS` 443) — no Lightsail as regras de IPv4 e IPv6 são independentes.

---

## Fase 8 — Apontar o domínio

No painel onde `trokservice.com.br` está registrado, crie:

| Tipo | Nome/Host      | Valor                                      |
|------|-----------------|---------------------------------------------|
| A    | `auditoria`     | `15.229.168.209`                            |
| AAAA | `auditoria`     | `2600:1f1e:b26:d00:a82b:e75a:2b70:920b`     |

Isso não mexe no seu outro servidor — é só um novo registro apontando o subdomínio `auditoria.trokservice.com.br` para essa instância Lightsail.

A propagação costuma levar de alguns minutos a poucas horas. Para checar:

```bash
nslookup auditoria.trokservice.com.br
```

---

## Fase 9 — HTTPS (Let's Encrypt)

**Só faça isso depois que o DNS já estiver propagado** (o `nslookup` acima já mostra o IP correto).

```bash
sudo apt-get install -y certbot python3-certbot-nginx
sudo certbot --nginx -d auditoria.trokservice.com.br
```

Escolha a opção de redirecionar HTTP para HTTPS quando perguntado. Depois, edite o `.env` de novo:

```bash
cd ~/auditoria-lojas
nano .env
```

Mude `COOKIE_SECURE=false` para `COOKIE_SECURE=true`, salve e reinicie:

```bash
pm2 restart auditoria-lojas
```

O certificado renova sozinho (o certbot já instala um agendamento automático).

---

## Fase 10 — Testar

Acesse `https://auditoria.trokservice.com.br` (ou `http://15.229.168.209:3000` antes de configurar o Nginx/domínio, se quiser testar rápido). Deve aparecer a tela de login. Entre com a senha configurada na Fase 3, registre uma visita de teste e confirme que ela aparece na aba **Visitas** com os novos filtros **De / Até**.

---

## Como atualizar o app no futuro

Sempre que eu (ou vocês) alterarem o código:

```bash
# 1. Enviar o novo .zip pelo botão de upload do terminal SSH
mkdir -p ~/auditoria-lojas-novo
unzip -o ~/auditoria-lojas-deploy.zip -d ~/auditoria-lojas-novo

# 2. Copiar por cima, preservando o .env e o banco de dados
cp ~/auditoria-lojas-novo/server.js ~/auditoria-lojas-novo/db.js ~/auditoria-lojas-novo/package.json ~/auditoria-lojas/
cp -r ~/auditoria-lojas-novo/public ~/auditoria-lojas-novo/views ~/auditoria-lojas/
cd ~/auditoria-lojas
npm install
pm2 restart auditoria-lojas
```

O banco (`~/auditoria-lojas/data/auditoria.db`) nunca é apagado nesse processo — é onde ficam as visitas de verdade.

## Backup do banco de dados do servidor

Além do backup manual pelo próprio app (aba **Backup**), vale baixar o arquivo do banco de vez em quando pelo botão de **download** do terminal SSH do Lightsail:

```bash
ls -la ~/auditoria-lojas/data/auditoria.db
```
