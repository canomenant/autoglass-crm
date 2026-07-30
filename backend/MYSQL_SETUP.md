# Setup

## 1. Editar `.env` con credenciales reales (Hostinger o local)

## 2. Importar SQL

```
node scripts/import-sql.js ./sql
```

## 3. Ejecutar backend local

```
npm install
npm run dev
```

## 4. Local MySQL (opcional, para probar sin tocar Hostinger)

```
DB_HOST=127.0.0.1 DB_PORT=3306 DB_USER=root DB_PASSWORD=root DB_NAME=autoglass_crm node scripts/import-sql.js ./sql
```
