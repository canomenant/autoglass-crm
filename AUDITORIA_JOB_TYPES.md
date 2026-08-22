# Auditoría de márgenes por Job Type

Generado 2026-08-22 · solo lectura · 
`backend/scripts/audit-job-type-margins.js`

Margen por orden = `total_sale − glass_cost − labor_cost − commission − impuesto`.
El impuesto sale de `computeTotals()` sobre el quote, que es donde vive la tasa snapshoteada.

## Población

| | |
|---|---|
| work orders activas | 4580 |
| con pago registrado | 3555 |
| con quote vinculado (población del análisis) | **3554** |
| excluidas por no tener quote | 1 |
| line items en total | 4341 |

## 1. Catálogo vs uso real

Job types en el catálogo: **35**. Aparecen en line items: **29**.

- **Nunca usados** (8): Rear Left Window Regulator, Door Glass Replacement, Back Glass Replacement, Molding Replacement, Supplies, Calibration, Rock Chip Repair, Mobile Service
- **Usados pero fuera del catálogo** (1): Rear left Window Regulator

| Job type | Line items | Órdenes |
|---|---:|---:|
| Windshield Replacement | 2428 | 2276 |
| Back Glass | 387 | 350 |
| Molding | 334 | 327 |
| Chip Repair | 206 | 183 |
| Front Left Door Glass | 201 | 187 |
| Front Right Door Glass | 192 | 182 |
| Rear Right Door Glass | 171 | 159 |
| Rear Left Door Glass | 146 | 131 |
| Rain Sensor Pad | 68 | 67 |
| Labor | 48 | 47 |
| Delivery Surcharge | 40 | 40 |
| Front Left Vent Glass | 15 | 13 |
| Front Left Window Regulator | 14 | 14 |
| Rear Left Quarter Glass | 10 | 10 |
| Rear left Window Regulator | 8 | 8 |
| Front Right Quarter Glass | 8 | 7 |
| Front Right Window Regulator | 8 | 8 |
| Front Left Quarter Glass | 8 | 7 |
| Rear Right Quarter Glass | 7 | 7 |
| Rear Right Vent Glass | 7 | 7 |
| Rear Right Window Regulator | 5 | 5 |
| Front Right Vent Glass | 5 | 5 |
| Trip | 5 | 4 |
| Rear Left Vent Glass | 3 | 2 |
| Gasket | 3 | 3 |
| Roll Up Window | 3 | 3 |
| Window Installation | 2 | 2 |
| Windshield Cowling | 1 | 1 |

## 2 y 3. Margen histórico y consistencia

Estadísticas calculadas **solo sobre órdenes de un único job type** — ver punto 4.
`CV` = desviación / |promedio|. Menor es más consistente.

| Job type | n | Promedio | Mediana | Mín | Máx | Desv | CV | Sirve de default |
|---|---:|---:|---:|---:|---:|---:|---:|---|
| Windshield Replacement | 1834 | $116.81 | $115.00 | $-603.94 | $1,921.07 | $77.31 | 0.66 | **no** |
| Back Glass | 330 | $116.16 | $115.01 | $-370.00 | $234.01 | $43.30 | 0.37 | con reservas |
| Molding | 0 | — | — | — | — | — | — | sin órdenes puras |
| Chip Repair | 182 | $58.22 | $54.00 | $-10.00 | $314.00 | $30.75 | 0.53 | con reservas |
| Front Left Door Glass | 170 | $125.27 | $120.00 | $55.00 | $405.00 | $29.27 | 0.23 | **sí** |
| Front Right Door Glass | 165 | $119.66 | $116.00 | $-240.00 | $150.00 | $31.71 | 0.26 | **sí** |
| Rear Right Door Glass | 144 | $124.87 | $130.00 | $-30.00 | $250.00 | $27.06 | 0.22 | **sí** |
| Rear Left Door Glass | 117 | $130.34 | $134.01 | $35.00 | $507.96 | $40.51 | 0.31 | **sí** |
| Rain Sensor Pad | 0 | — | — | — | — | — | — | sin órdenes puras |
| Labor | 44 | $141.49 | $129.20 | $35.00 | $465.00 | $76.09 | 0.54 | con reservas |
| Delivery Surcharge | 0 | — | — | — | — | — | — | sin órdenes puras |
| Front Left Vent Glass | 12 | $135.99 | $124.51 | $55.00 | $250.00 | $48.27 | 0.35 | con reservas |
| Front Left Window Regulator | 13 | $166.00 | $115.01 | $-110.00 | $1,040.70 | $260.01 | 1.57 | **no** |
| Rear Left Quarter Glass | 9 | $130.00 | $116.00 | $95.00 | $215.00 | $32.60 | 0.25 | muestra chica |
| Rear left Window Regulator | 8 | $120.63 | $120.00 | $100.00 | $135.01 | $11.58 | 0.10 | muestra chica |
| Front Right Quarter Glass | 7 | $134.58 | $115.00 | $94.01 | $240.00 | $44.68 | 0.33 | muestra chica |
| Front Right Window Regulator | 8 | $104.03 | $114.99 | $65.00 | $134.01 | $21.73 | 0.21 | muestra chica |
| Front Left Quarter Glass | 7 | $110.22 | $123.54 | $34.01 | $135.00 | $33.88 | 0.31 | muestra chica |
| Rear Right Quarter Glass | 6 | $121.67 | $127.50 | $85.00 | $140.01 | $18.63 | 0.15 | muestra chica |
| Rear Right Vent Glass | 6 | $124.00 | $115.00 | $114.01 | $150.00 | $13.78 | 0.11 | muestra chica |
| Rear Right Window Regulator | 5 | $203.22 | $115.01 | $115.00 | $536.10 | $166.62 | 0.82 | muestra chica |
| Front Right Vent Glass | 4 | $123.26 | $114.51 | $114.01 | $150.00 | $15.45 | 0.13 | muestra chica |
| Trip | 4 | $28.75 | $20.00 | $0.00 | $75.00 | $31.30 | 1.09 | muestra chica |
| Rear Left Vent Glass | 2 | $114.50 | $114.50 | $114.01 | $115.00 | $0.49 | 0.00 | muestra chica |
| Gasket | 0 | — | — | — | — | — | — | sin órdenes puras |
| Roll Up Window | 3 | $28.33 | $65.00 | $-115.00 | $135.00 | $105.30 | 3.72 | muestra chica |
| Window Installation | 2 | $210.00 | $210.00 | $200.00 | $220.00 | $10.00 | 0.05 | muestra chica |
| Windshield Cowling | 1 | $115.00 | $115.00 | $115.00 | $115.00 | $0.00 | 0.00 | muestra chica |

## 4. Órdenes con varios job types

| | |
|---|---:|
| un solo job type | 3083 |
| **varios job types** | **471** |
| sin job type en ningún line item | 0 |

**Cómo se atribuye:** una orden de un solo tipo aporta su margen entero a ese tipo. Una con varios lo reparte
proporcionalmente al `pricePart` de cada line item — es lo único en los datos que dice cuánto pesa cada trabajo
dentro de la orden. Si todos los `pricePart` son 0, se reparte en partes iguales.

Las estadísticas del punto 3 **excluyen** las órdenes multi-tipo a propósito: una porción prorrateada no es un
margen observado sino un supuesto, y mezclarla en la distribución inventa dispersión que nadie midió.
Los totales del punto 5 **sí** las incluyen, porque ahí el objetivo es que la suma cierre.

Ejemplos:

- `Wo-0112` — Windshield Replacement + Molding — margen $124.51
- `Wo-0853` — Windshield Replacement + Molding — margen $153.57
- `Wo-0381` — Rain Sensor Pad + Windshield Replacement + Rear Left Door Glass — margen $270.00
- `Wo-1115` — Molding + Windshield Replacement — margen $160.73
- `Wo-0117` — Molding + Windshield Replacement — margen $150.00

## 5. ¿Cierra contra los $869,916.96 sin atribuir?

| Job type | Margen atribuido | % del total |
|---|---:|---:|
| Windshield Replacement | $246,180.17 | 58.0% |
| Back Glass | $41,495.05 | 9.8% |
| Molding | $20,804.47 | 4.9% |
| Chip Repair | $10,596.74 | 2.5% |
| Front Left Door Glass | $21,895.97 | 5.2% |
| Front Right Door Glass | $21,044.26 | 5.0% |
| Rear Right Door Glass | $18,756.14 | 4.4% |
| Rear Left Door Glass | $18,644.10 | 4.4% |
| Rain Sensor Pad | $3,757.15 | 0.9% |
| Labor | $6,367.11 | 1.5% |
| Delivery Surcharge | $2,237.93 | 0.5% |
| Front Left Vent Glass | $1,631.83 | 0.4% |
| Front Left Window Regulator | $2,157.96 | 0.5% |
| Rear Left Quarter Glass | $1,050.01 | 0.2% |
| Rear left Window Regulator | $965.00 | 0.2% |
| Front Right Quarter Glass | $942.04 | 0.2% |
| Front Right Window Regulator | $832.25 | 0.2% |
| Front Left Quarter Glass | $771.55 | 0.2% |
| Rear Right Quarter Glass | $1,092.27 | 0.3% |
| Rear Right Vent Glass | $549.00 | 0.1% |
| Rear Right Window Regulator | $1,016.09 | 0.2% |
| Front Right Vent Glass | $493.02 | 0.1% |
| Trip | $115.00 | 0.0% |
| Rear Left Vent Glass | $229.00 | 0.1% |
| Gasket | $207.50 | 0.0% |
| Roll Up Window | $85.00 | 0.0% |
| Window Installation | $420.00 | 0.1% |
| Windshield Cowling | $115.00 | 0.0% |
| **TOTAL** | **$424,451.64** | 100% |

| | |
|---|---:|
| margen sumado por job type | $424,451.64 |
| bucket sin atribuir del P&L | $869,916.96 |
| diferencia | $-445,465.32 |
| cobertura | 48.8% |

**No cierra, y no tenía por qué: las dos fórmulas no miden lo mismo.** El bucket del P&L es
ingreso **bruto** sin clasificar; el margen de esta auditoría es **neto**, después de pagarle al
técnico y al agente. La diferencia se explica entera:

| | |
|---|---:|
| margen neto sumado por job type | $424,451.64 |
| + mano de obra del técnico (el margen la resta, el bucket no) | $413,795.94 |
| + comisión del agente (ídem) | $51,739.66 |
| + cobrado por encima de total_sale | $153,638.13 |
| − upsell (el bucket ya lo categoriza aparte) | $-171,604.16 |
| − calibración (ídem) | $-1,250.00 |
| − price tier (ídem) | $-750.00 |
| − labor de line items (ídem) | $-243.25 |
| **= bucket sin atribuir** | **$869,777.96** |

Residuo contra el valor medido: **$-139.00**.

**La conclusión sí cierra el círculo:** el bucket no es un agujero contable. Es margen operativo
bruto. Una vez descontados los pagos al técnico y al agente, lo que queda como margen real del
negocio es **$424,451.64**, y esta auditoría lo tiene clasificado por tipo de trabajo.

