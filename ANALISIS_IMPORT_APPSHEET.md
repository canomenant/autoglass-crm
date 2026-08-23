# Análisis del import de AppSheet — Fase 1

Generado 2026-08-23 · **solo lectura, no se escribió nada**
`backend/scripts/analyze-appsheet-import.js`

## 1. Cobertura del enlace

| | |
|---|---:|
| líneas de detalle | 4643 |
| con `WORKORDER_LABEL` en formato Wo-#### | 4342 |
| **resuelven a una work order existente** | **4342** (93.5%) |
| con label pero sin work order en la base | 0 |
| **huérfanas (label vacío)** | **301** |
| work orders distintas alcanzadas | 3809 de 4580 |

## 2. Líneas a completar vs a crear

| | |
|---|---:|
| **completar** una línea existente (match por part number) | **4043** |
| **crear** línea nueva | **299** |
| de esas, work orders sin quote vinculado | 1 |

De las que se completan, campos que hoy están vacíos y el export puede llenar:

| Campo | A llenar | Ya tienen dato (no se tocan) |
|---|---:|---:|
| calibrationType | 0 | 7 |
| priceTier | 3391 | 1 |
| pricePart | 568 | 3272 |
| distributor | 4 | 3795 |
| orderNumber | 7 | 3798 |

## A. `Glass Cost` vs `pricePart`

| | |
|---|---:|
| `Glass Cost` todas las líneas | $474,665.94 |
| `Glass Cost` solo líneas que resuelven | $443,861.30 |
| `glass_cost` actual en work_orders | $424,201.80 |
| diferencia | $19,659.50 |

| TYPE PART | Líneas | `Glass Cost` |
|---|---:|---:|
| Parts | 4011 | $468,310.64 |
| Molding | 321 | $5,832.30 |
| Services | 311 | $523.00 |

## Reconciliación: `Glass Cost` por WO vs `glass_cost` actual

Work orders comparadas: **3809** · **cuadran exacto: 3315** · no cuadran: **494**

Las 15 mayores diferencias (no se corrigen, solo se listan):

| WO | Export | Actual | Diferencia |
|---|---:|---:|---:|
| Wo-2592 | $179.20 | $800.00 | $-620.80 |
| Wo-1332 | $600.00 | $0.00 | $600.00 |
| Wo-1260 | $565.00 | $0.00 | $565.00 |
| Wo-3345 | $544.50 | $0.00 | $544.50 |
| Wo-3191 | $512.00 | $0.00 | $512.00 |
| Wo-0954 | $467.35 | $0.00 | $467.35 |
| Wo-2671 | $441.22 | $0.00 | $441.22 |
| Wo-3181 | $421.17 | $0.00 | $421.17 |
| Wo-0848 | $420.82 | $0.00 | $420.82 |
| Wo-1119 | $380.01 | $0.00 | $380.01 |
| Wo-3818 | $340.56 | $0.00 | $340.56 |
| Wo-0081 | $336.00 | $0.00 | $336.00 |
| Wo-0093 | $330.61 | $0.00 | $330.61 |
| Wo-2166 | $311.02 | $0.00 | $311.02 |
| Wo-0891 | $289.68 | $0.00 | $289.68 |

Suma de todas las diferencias: **$19,924.52**

## B. Campos sin destino en el esquema actual

| Campo del export | Suma (líneas que resuelven) | Destino |
|---|---:|---|
| `AMOUNT` (monto del price tier) | $847,600.00 | **no existe** |
| `TOTAL_LABOR` (cobrado al cliente) | $849,950.00 | **no existe** — distinto del pagado al técnico |
| `SERVICES_AMOUNT` | $43,290.31 | **no existe** |
| `AMOUNT_CALIBRATION_TYPE` | $2,100.00 | **no existe** (hay `calibrationType`, sin monto) |

## C. Campos NAGS — excluidos

| Campo | Con dato | % |
|---|---:|---:|
| `List Price` | 2 de 4643 | 0.0% |
| `Nags Discount Rate` | 2 de 4643 | 0.0% |
| `Amount List Price` | 2 de 4643 | 0.0% |
| `Nags Labour Hour` | 2 de 4643 | 0.0% |
| `Price for hour` | 2 de 4643 | 0.0% |
| `Total Labor Hour` | 7 de 4643 | 0.2% |

## D. Huérfanas

Líneas de detalle sin `WORKORDER_LABEL`: **301**. Aportan $30,804.64 de `Glass Cost`.

Work orders de la base sin ninguna línea en el export: **771**.

Primeras 20: Wo-2641, Wo-3856, Wo-3874, Wo-3875, Wo-3876, Wo-3877, Wo-3878, Wo-3879, Wo-3880, Wo-3453, Wo-3881, Wo-3882, Wo-3869, Wo-3883, Wo-3890, Wo-3873, Wo-3884, Wo-3891, Wo-3899, Wo-3886

## Labor de técnicos y comisiones de agentes

| | Export | Sistema actual | Diferencia |
|---|---:|---:|---:|
| Labor a técnicos | $417,160.94 | $417,160.94 | $0.00 |
| Comisión a agentes | $52,196.47 | $52,196.47 | $-0.00 |

Filas que resuelven a una WO: técnicos **3567 de 3567**, agentes **3573 de 3573**.

Work orders con más de un técnico: **1** — por eso el detalle necesita tabla propia, no un campo en la cabecera.


---

## Listas para revisión contable

### 44 work orders con `total_sale = 0` — posibles garantías o re-trabajos

| WO | Costo a asignar |
|---|---:|
| Wo-1332 | $600.00 |
| Wo-1260 | $565.00 |
| Wo-3191 | $512.00 |
| Wo-2671 | $441.22 |
| Wo-3181 | $421.17 |
| Wo-0848 | $420.82 |
| Wo-1119 | $380.01 |
| Wo-0081 | $336.00 |
| Wo-0093 | $330.61 |
| Wo-2166 | $311.02 |
| Wo-0891 | $289.68 |
| Wo-2149 | $287.61 |
| Wo-2945 | $229.00 |
| Wo-1657 | $223.00 |
| Wo-1914 | $223.00 |
| Wo-3474 | $222.98 |
| Wo-1127 | $183.59 |
| Wo-2649 | $183.02 |
| Wo-0196 | $161.70 |
| Wo-3101 | $159.16 |
| Wo-2799 | $157.46 |
| Wo-1300 | $157.01 |
| Wo-2513 | $156.29 |
| Wo-0538 | $153.15 |
| Wo-1148 | $143.30 |
| Wo-2152 | $140.09 |
| Wo-1271 | $128.21 |
| Wo-2264 | $125.00 |
| Wo-3184 | $124.00 |
| Wo-1326 | $117.72 |
| Wo-2899 | $115.50 |
| Wo-3546 | $114.00 |
| Wo-2550 | $113.12 |
| Wo-3476 | $110.99 |
| Wo-2567 | $105.11 |
| Wo-0799 | $104.28 |
| Wo-0334 | $101.17 |
| Wo-1082 | $100.00 |
| Wo-0178 | $94.15 |
| Wo-1263 | $94.00 |
| Wo-1547 | $87.40 |
| Wo-1510 | $73.42 |
| Wo-0293 | $63.82 |
| Wo-3130 | $9.40 |

### 9 con `total_sale` positivo muy por debajo del costo — posible ingreso de aseguranza no registrado

| WO | Venta | Costo | Diferencia |
|---|---:|---:|---:|
| Wo-3345 | $350.00 | $544.50 | $-194.50 |
| Wo-0954 | $37.83 | $467.35 | $-429.52 |
| Wo-0521 | $13.86 | $220.05 | $-206.19 |
| Wo-0359 | $14.57 | $181.87 | $-167.30 |
| Wo-2536 | $13.50 | $179.51 | $-166.01 |
| Wo-2763 | $15.89 | $139.15 | $-123.26 |
| Wo-3096 | $19.78 | $136.28 | $-116.50 |
| Wo-1220 | $13.80 | $128.75 | $-114.95 |
| Wo-0131 | $22.81 | $113.78 | $-90.97 |

### 10 excluidas — `total_sale` negativo, posibles chargebacks, pendiente criterio contable

| WO | Venta | Costo que NO se asignó |
|---|---:|---:|
| Wo-3818 | $-500.00 | $340.56 |
| Wo-3532 | $-50.00 | $245.44 |
| Wo-3384 | $-150.00 | $198.00 |
| Wo-3489 | $-88.00 | $188.00 |
| Wo-3651 | $-100.00 | $182.35 |
| Wo-3493 | $-50.00 | $108.17 |
| Wo-3192 | $-100.00 | $103.91 |
| Wo-3613 | $-88.34 | $90.77 |
| Wo-3848 | $-250.00 | $88.24 |
| Wo-3450 | $-250.00 | $76.11 |


---

## Listas para revisión contable

### 44 work orders con `total_sale = 0` — posibles garantías o re-trabajos

| WO | Costo a asignar |
|---|---:|
| Wo-1332 | $600.00 |
| Wo-1260 | $565.00 |
| Wo-3191 | $512.00 |
| Wo-2671 | $441.22 |
| Wo-3181 | $421.17 |
| Wo-0848 | $420.82 |
| Wo-1119 | $380.01 |
| Wo-0081 | $336.00 |
| Wo-0093 | $330.61 |
| Wo-2166 | $311.02 |
| Wo-0891 | $289.68 |
| Wo-2149 | $287.61 |
| Wo-2945 | $229.00 |
| Wo-1657 | $223.00 |
| Wo-1914 | $223.00 |
| Wo-3474 | $222.98 |
| Wo-1127 | $183.59 |
| Wo-2649 | $183.02 |
| Wo-0196 | $161.70 |
| Wo-3101 | $159.16 |
| Wo-2799 | $157.46 |
| Wo-1300 | $157.01 |
| Wo-2513 | $156.29 |
| Wo-0538 | $153.15 |
| Wo-1148 | $143.30 |
| Wo-2152 | $140.09 |
| Wo-1271 | $128.21 |
| Wo-2264 | $125.00 |
| Wo-3184 | $124.00 |
| Wo-1326 | $117.72 |
| Wo-2899 | $115.50 |
| Wo-3546 | $114.00 |
| Wo-2550 | $113.12 |
| Wo-3476 | $110.99 |
| Wo-2567 | $105.11 |
| Wo-0799 | $104.28 |
| Wo-0334 | $101.17 |
| Wo-1082 | $100.00 |
| Wo-0178 | $94.15 |
| Wo-1263 | $94.00 |
| Wo-1547 | $87.40 |
| Wo-1510 | $73.42 |
| Wo-0293 | $63.82 |
| Wo-3130 | $9.40 |

### 9 con `total_sale` positivo muy por debajo del costo — posible ingreso de aseguranza no registrado

| WO | Venta | Costo | Diferencia |
|---|---:|---:|---:|
| Wo-3345 | $350.00 | $544.50 | $-194.50 |
| Wo-0954 | $37.83 | $467.35 | $-429.52 |
| Wo-0521 | $13.86 | $220.05 | $-206.19 |
| Wo-0359 | $14.57 | $181.87 | $-167.30 |
| Wo-2536 | $13.50 | $179.51 | $-166.01 |
| Wo-2763 | $15.89 | $139.15 | $-123.26 |
| Wo-3096 | $19.78 | $136.28 | $-116.50 |
| Wo-1220 | $13.80 | $128.75 | $-114.95 |
| Wo-0131 | $22.81 | $113.78 | $-90.97 |

### 10 excluidas — `total_sale` negativo, posibles chargebacks, pendiente criterio contable

| WO | Venta | Costo que NO se asignó |
|---|---:|---:|
| Wo-3818 | $-500.00 | $340.56 |
| Wo-3532 | $-50.00 | $245.44 |
| Wo-3384 | $-150.00 | $198.00 |
| Wo-3489 | $-88.00 | $188.00 |
| Wo-3651 | $-100.00 | $182.35 |
| Wo-3493 | $-50.00 | $108.17 |
| Wo-3192 | $-100.00 | $103.91 |
| Wo-3613 | $-88.34 | $90.77 |
| Wo-3848 | $-250.00 | $88.24 |
| Wo-3450 | $-250.00 | $76.11 |


---

## Listas para revisión contable

### 44 work orders con `total_sale = 0` — posibles garantías o re-trabajos

| WO | Costo a asignar |
|---|---:|
| Wo-1332 | $600.00 |
| Wo-1260 | $565.00 |
| Wo-3191 | $512.00 |
| Wo-2671 | $441.22 |
| Wo-3181 | $421.17 |
| Wo-0848 | $420.82 |
| Wo-1119 | $380.01 |
| Wo-0081 | $336.00 |
| Wo-0093 | $330.61 |
| Wo-2166 | $311.02 |
| Wo-0891 | $289.68 |
| Wo-2149 | $287.61 |
| Wo-2945 | $229.00 |
| Wo-1657 | $223.00 |
| Wo-1914 | $223.00 |
| Wo-3474 | $222.98 |
| Wo-1127 | $183.59 |
| Wo-2649 | $183.02 |
| Wo-0196 | $161.70 |
| Wo-3101 | $159.16 |
| Wo-2799 | $157.46 |
| Wo-1300 | $157.01 |
| Wo-2513 | $156.29 |
| Wo-0538 | $153.15 |
| Wo-1148 | $143.30 |
| Wo-2152 | $140.09 |
| Wo-1271 | $128.21 |
| Wo-2264 | $125.00 |
| Wo-3184 | $124.00 |
| Wo-1326 | $117.72 |
| Wo-2899 | $115.50 |
| Wo-3546 | $114.00 |
| Wo-2550 | $113.12 |
| Wo-3476 | $110.99 |
| Wo-2567 | $105.11 |
| Wo-0799 | $104.28 |
| Wo-0334 | $101.17 |
| Wo-1082 | $100.00 |
| Wo-0178 | $94.15 |
| Wo-1263 | $94.00 |
| Wo-1547 | $87.40 |
| Wo-1510 | $73.42 |
| Wo-0293 | $63.82 |
| Wo-3130 | $9.40 |

### 9 con `total_sale` positivo muy por debajo del costo — posible ingreso de aseguranza no registrado

| WO | Venta | Costo | Diferencia |
|---|---:|---:|---:|
| Wo-3345 | $350.00 | $544.50 | $-194.50 |
| Wo-0954 | $37.83 | $467.35 | $-429.52 |
| Wo-0521 | $13.86 | $220.05 | $-206.19 |
| Wo-0359 | $14.57 | $181.87 | $-167.30 |
| Wo-2536 | $13.50 | $179.51 | $-166.01 |
| Wo-2763 | $15.89 | $139.15 | $-123.26 |
| Wo-3096 | $19.78 | $136.28 | $-116.50 |
| Wo-1220 | $13.80 | $128.75 | $-114.95 |
| Wo-0131 | $22.81 | $113.78 | $-90.97 |

### 10 excluidas — `total_sale` negativo, posibles chargebacks, pendiente criterio contable

| WO | Venta | Costo que NO se asignó |
|---|---:|---:|
| Wo-3818 | $-500.00 | $340.56 |
| Wo-3532 | $-50.00 | $245.44 |
| Wo-3384 | $-150.00 | $198.00 |
| Wo-3489 | $-88.00 | $188.00 |
| Wo-3651 | $-100.00 | $182.35 |
| Wo-3493 | $-50.00 | $108.17 |
| Wo-3192 | $-100.00 | $103.91 |
| Wo-3613 | $-88.34 | $90.77 |
| Wo-3848 | $-250.00 | $88.24 |
| Wo-3450 | $-250.00 | $76.11 |

