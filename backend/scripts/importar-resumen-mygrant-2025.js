require("dotenv").config();
const fs = require("fs");
const path = require("path");
const pool = require("../src/config/db");
const statementsStore = require("../src/store/statements.store");

// Resúmenes 2025 de Mygrant, pasados por Antonio el 4-sep-2026 para cuadrar los pagos de 2025
// factura por factura, como ya se hizo con 2026. A diferencia del resumen 2026 (que traía saldos),
// el de 2025 trae el MONTO de cada factura: 2025 está cerrado y todo se pagó.
//
//   node scripts/importar-resumen-mygrant-2025.js            -> solo reporta
//   node scripts/importar-resumen-mygrant-2025.js --apply    -> escribe
//
// Pasos: 1) registrar cada factura como statement (o cotejar la que ya existe), 2) amarrar los
// paquetes semanales (factura + memo de crédito) a los lotes de 2025 de esa región cuando suman
// exactamente lo pagado, 3) verificar. Un lote solo se amarra si la solución es única.

const APPLY = process.argv.includes("--apply");
const ACTOR = "Resumen Mygrant 2025 (2026-09-04)";
const money = (n) => Math.round(Number(n || 0) * 100) / 100;
const fmt = (n) => money(n).toFixed(2);
const eq = (a, b) => Math.abs(money(a) - money(b)) < 0.005;
const informe = [];
function log(...a) { const s = a.join(" "); informe.push(s); console.log(s); }
function titulo(t) { log("\n" + "=".repeat(78) + "\n" + t + "\n" + "=".repeat(78)); }
const iso = (f) => { const m = f.match(/^(\d{2})\/(\d{2})\/(\d{4})$/); return `${m[3]}-${m[1]}-${m[2]}`; };
const num = (s) => Number(String(s).replace(/,/g, ""));
// Renglones tal como los pasó Antonio: fecha, número, monto y (en Texas) la sucursal.
const filasDe = (raw) => raw.trim().split(/\r?\n/)
  .map((l) => l.trim().split(/\t+| {2,}/).map((x) => x.trim()).filter(Boolean))
  .filter((c) => /^\d{2}\/\d{2}\/\d{4}$/.test(c[0]))
  .map((c) => [c[0], c[1], c[2], c[3] || null]);

const REGIONES = [
  {
    nombre: "Southern California", branch: "Newport Beach", distributor: "Mygrant Anaheim",
    // A quién le pagan los lotes de esta región (partes de las obligaciones).
    partes: ["Mygrant Anaheim", "Mygrant Compton", "Mygrant Riverside", "Mygrant San Fernando", "Mygrant La Puente"],
    filas: [
      ["01/05/2025", "I04527976-0", "-266.02"], ["01/05/2025", "I04527975-0", "2,576.18"],
      ["01/12/2025", "I04531043-0", "-256.60"], ["01/12/2025", "I04531042-0", "1,730.55"],
      ["01/19/2025", "I04539071-0", "-57.56"], ["01/19/2025", "I04539070-0", "1,099.78"],
      ["01/26/2025", "I04542473-0", "-128.72"], ["01/26/2025", "I04542472-0", "1,513.32"],
      ["01/31/2025", "I04545897-0", "-441.69"], ["01/31/2025", "I04545896-0", "2,481.65"],
      ["02/02/2025", "I04552861-0", "200.93"],
      ["02/09/2025", "I04555202-0", "-203.85"], ["02/09/2025", "I04555201-0", "2,221.23"],
      ["02/16/2025", "I04563616-0", "-351.87"], ["02/16/2025", "I04563615-0", "1,709.14"],
      ["02/23/2025", "I04567050-0", "-284.52"], ["02/23/2025", "I04567049-0", "3,602.25"],
      ["02/28/2025", "I04570661-0", "-186.06"], ["02/28/2025", "I04570660-0", "2,364.24"],
      ["03/02/2025", "I04577558-0", "157.84"], ["03/02/2025", "I04577559-0", "184.93"],
      ["03/09/2025", "I04580077-0", "-275.05"], ["03/09/2025", "I04580076-0", "2,650.62"],
      ["03/16/2025", "I04588701-0", "-633.97"], ["03/16/2025", "I04588700-0", "3,000.92"],
      ["03/23/2025", "I04592243-0", "-301.28"], ["03/23/2025", "I04592242-0", "3,635.01"],
      ["03/30/2025", "I04595750-0", "2,591.84"], ["03/30/2025", "I04595751-0", "-581.57"],
      ["03/31/2025", "I04597926-0", "594.03"], ["03/31/2025", "I04597927-0", "-285.63"],
      ["04/06/2025", "I04606183-0", "3,285.54"], ["04/06/2025", "I04606184-0", "-256.34"],
      ["04/13/2025", "I04610168-0", "3,746.19"],
      ["04/20/2025", "I04619673-0", "-309.48"], ["04/20/2025", "I04619672-0", "2,687.59"],
      ["04/27/2025", "I04623682-0", "-472.14"], ["04/27/2025", "I04623681-0", "2,028.32"],
      ["04/30/2025", "I04626893-0", "-164.90"], ["04/30/2025", "I04626892-0", "1,167.53"],
      ["05/04/2025", "I04635070-0", "-768.15"], ["05/04/2025", "I04635069-0", "1,276.47"],
      ["05/11/2025", "I04638815-0", "-824.51"], ["05/11/2025", "I04638814-0", "2,227.72"],
      ["05/18/2025", "I04648366-0", "-1,079.76"], ["05/18/2025", "I04648365-0", "3,929.25"],
      ["05/25/2025", "I04652323-0", "-217.08"], ["05/25/2025", "I04652322-0", "4,849.29"],
      ["05/31/2025", "I04656107-0", "-399.09"], ["05/31/2025", "I04656106-0", "2,490.73"],
      ["06/08/2025", "I04665670-0", "-571.23"], ["06/08/2025", "I04665669-0", "3,311.97"],
      ["06/15/2025", "I04669075-0", "-525.61"], ["06/15/2025", "I04669074-0", "4,337.15"],
      ["06/22/2025", "I04677785-0", "-1,643.27"], ["06/22/2025", "I04677784-0", "3,038.26"],
      ["06/29/2025", "I04681314-0", "-134.06"], ["06/29/2025", "I04681313-0", "2,483.03"],
      ["06/30/2025", "I04683288-0", "889.77"],
      ["07/06/2025", "I04689434-0", "-354.07"], ["07/06/2025", "I04689433-0", "1,429.45"],
      ["07/13/2025", "I04692154-0", "-156.11"], ["07/13/2025", "I04692153-0", "2,269.75"],
      ["07/20/2025", "I04709169-0", "-188.31"], ["07/20/2025", "I04709168-0", "3,972.32"],
      ["07/27/2025", "I04713462-0", "-302.14"], ["07/27/2025", "I04713461-0", "4,052.21"],
      ["07/31/2025", "I04717475-0", "-205.60"], ["07/31/2025", "I04717474-0", "1,416.91"],
      ["08/03/2025", "I04725680-0", "625.30"],
      ["08/10/2025", "I04729647-0", "-119.97"], ["08/10/2025", "I04729646-0", "2,843.58"],
      ["08/17/2025", "I04739685-0", "-300.44"], ["08/17/2025", "I04739684-0", "3,732.90"],
      ["08/24/2025", "I04744139-0", "-655.81"], ["08/24/2025", "I04744138-0", "2,778.89"],
      ["08/27/2025", "I04746870-0", "-149.23"], ["08/27/2025", "I04746869-0", "431.96"],
      ["08/31/2025", "I04748698-0", "1,015.71"],
      ["09/07/2025", "I04758187-0", "-571.24"], ["09/07/2025", "I04758186-0", "2,956.90"],
      ["09/14/2025", "I04762017-0", "-239.33"], ["09/14/2025", "I04762016-0", "1,766.13"],
      ["09/21/2025", "I04771664-0", "-350.68"], ["09/21/2025", "I04771663-0", "3,087.36"],
      ["09/28/2025", "I04775509-0", "-139.91"], ["09/28/2025", "I04775508-0", "2,293.57"],
      ["09/30/2025", "I04778106-0", "-79.82"], ["09/30/2025", "I04778105-0", "912.92"],
      ["10/05/2025", "I04786757-0", "-38.04"], ["10/05/2025", "I04786756-0", "2,056.98"],
      ["10/12/2025", "I04790348-0", "-865.12"], ["10/12/2025", "I04790347-0", "4,062.57"],
      ["10/19/2025", "I04799997-0", "-613.91"], ["10/19/2025", "I04799996-0", "3,729.34"],
      ["10/26/2025", "I04803785-0", "-157.46"], ["10/26/2025", "I04803784-0", "3,476.94"],
      ["10/31/2025", "I04807562-0", "-1,105.61"], ["10/31/2025", "I04807561-0", "3,006.39"],
      ["11/02/2025", "I04815132-0", "-84.09"], ["11/02/2025", "I04815131-0", "196.65"],
      ["11/09/2025", "I04817775-0", "-1,074.16"], ["11/09/2025", "I04817774-0", "4,703.84"],
      ["11/16/2025", "I04827227-0", "-240.28"], ["11/16/2025", "I04827226-0", "2,309.77"],
      ["11/23/2025", "I04831000-0", "-883.64"], ["11/23/2025", "I04830999-0", "2,520.74"],
      ["11/30/2025", "I04834399-0", "-295.39"], ["11/30/2025", "I04834398-0", "1,692.14"],
      ["12/07/2025", "I04843461-0", "-758.30"], ["12/07/2025", "I04843460-0", "3,901.22"],
      ["12/14/2025", "I04847252-0", "-995.21"], ["12/14/2025", "I04847251-0", "4,417.87"],
      ["12/21/2025", "I04856675-0", "-118.05"], ["12/21/2025", "I04856674-0", "2,100.03"],
      ["12/28/2025", "I04859825-0", "-238.42"], ["12/28/2025", "I04859824-0", "1,389.10"],
      ["12/31/2025", "I04862642-0", "-361.35"], ["12/31/2025", "I04862641-0", "1,424.16"],
    ],
  },
  {
    nombre: "North California", branch: "Fresno", distributor: "Mygrant Hayward",
    partes: ["Mygrant Hayward", "Mygrant Sacramento", "Mygrant San Jose", "Mygrant Oakland", "Mygrant Martinez", "Mygrant San Francisco"],
    filas: filasDe(`01/05/2025	I04527977-0	96.05
01/12/2025	I04531045-0	-212.17
01/12/2025	I04531044-0	1,217.61
01/19/2025	I04539073-0	-11.38
01/19/2025	I04539072-0	1,466.03
01/26/2025	I04542475-0	-57.86
01/26/2025	I04542474-0	1,416.54
01/31/2025	I04545898-0	1,073.69
02/02/2025	I04552862-0	240.00
02/09/2025	I04555204-0	-361.66
02/09/2025	I04555203-0	1,008.27
02/16/2025	I04563618-0	-85.38
02/16/2025	I04563617-0	1,938.00
02/23/2025	I04567052-0	-545.98
02/23/2025	I04567051-0	1,554.10
02/28/2025	I04570663-0	-410.10
02/28/2025	I04570662-0	2,185.89
03/09/2025	I04580079-0	-3.50
03/09/2025	I04580078-0	1,058.70
03/16/2025	I04588703-0	-168.24
03/16/2025	I04588702-0	761.34
03/23/2025	I04592245-0	-61.03
03/23/2025	I04592244-0	1,616.59
03/30/2025	I04595752-0	1,985.95
03/31/2025	I04597928-0	61.70
03/31/2025	I04597929-0	-79.86
04/06/2025	I04606185-0	1,101.11
04/06/2025	I04606186-0	-105.89
04/13/2025	I04610170-0	-391.33
04/13/2025	I04610169-0	1,678.70
04/20/2025	I04619675-0	-160.00
04/20/2025	I04619674-0	1,702.80
04/27/2025	I04623684-0	-183.33
04/27/2025	I04623683-0	1,035.90
04/30/2025	I04626894-0	1,361.97
05/04/2025	I04635072-0	-51.92
04/30/2025	I04626895-0	-51.92
05/04/2025	I04635071-0	1,264.70
05/11/2025	I04638817-0	-58.88
05/11/2025	I04638816-0	1,059.10
05/18/2025	I04648368-0	-369.64
05/18/2025	I04648367-0	525.98
05/25/2025	I04652325-0	-94.05
05/25/2025	I04652324-0	2,104.06
05/31/2025	I04656109-0	-382.11
05/31/2025	I04656108-0	850.54
06/08/2025	I04665672-0	-355.41
06/08/2025	I04665671-0	2,354.85
06/15/2025	I04669077-0	-334.13
06/15/2025	I04669076-0	2,921.81
06/22/2025	I04677787-0	-311.66
06/22/2025	I04677786-0	1,365.25
06/29/2025	I04681316-0	-64.73
06/29/2025	I04681315-0	2,298.32
06/30/2025	I04683289-0	148.16
07/06/2025	I04689435-0	448.21
07/13/2025	I04692156-0	-321.23
07/13/2025	I04692155-0	1,526.62
07/20/2025	I04709170-0	1,780.45
07/27/2025	I04713464-0	-88.00
07/27/2025	I04713463-0	1,721.51
07/31/2025	I04717477-0	-441.35
07/31/2025	I04717476-0	1,208.18
08/03/2025	I04725681-0	396.42
08/10/2025	I04729649-0	-144.00
08/10/2025	I04729648-0	2,319.45
08/17/2025	I04739687-0	-940.87
08/17/2025	I04739686-0	2,531.18
08/24/2025	I04744141-0	-390.82
08/24/2025	I04744140-0	1,738.40
08/27/2025	I04746872-0	-341.12
08/27/2025	I04746871-0	541.80
08/31/2025	I04748699-0	820.77
09/07/2025	I04758189-0	-153.93
09/07/2025	I04758188-0	558.76
09/14/2025	I04762018-0	707.68
09/21/2025	I04771666-0	-287.10
09/21/2025	I04771665-0	1,757.51
09/28/2025	I04775510-0	1,687.16
09/30/2025	I04778108-0	-477.33
09/30/2025	I04778107-0	727.77
10/05/2025	I04786758-0	1,002.21
10/12/2025	I04790350-0	-130.00
10/12/2025	I04790349-0	1,535.38
10/19/2025	I04799998-0	503.90
10/26/2025	I04803786-0	1,612.87
10/26/2025	I04803787-0	-224.47
10/31/2025	I04807563-0	1,874.90
11/02/2025	I04815133-0	71.53
11/09/2025	I04817777-0	-14.70
11/09/2025	I04817776-0	1,049.95
11/16/2025	I04827228-0	2,018.59
11/23/2025	I04831001-0	938.91
11/30/2025	I04834400-0	745.63
12/07/2025	I04843462-0	4,107.09
12/07/2025	I04843463-0	-2,097.52
12/14/2025	I04847254-0	-131.22
12/14/2025	I04847253-0	1,015.94
12/21/2025	I04856676-0	1,085.18
12/28/2025	I04859826-0	361.37
12/31/2025	I04862644-0	-418.69
12/31/2025	I04862643-0	1,982.01`),
  },
  {
    // Las cuatro cuentas de Texas se pagan juntas en un mismo lote, así que se cuadran como una
    // sola región; cada factura conserva su sucursal.
    nombre: "Texas", branch: "Texas", distributor: "Mygrant Austin",
    sucursales: {
      AUSTIN: { branch: "Austin, TX", distributor: "Mygrant Austin" },
      IRVING: { branch: "Irving, TX", distributor: "Mygrant Irving" },
      "SAN ANTONIO": { branch: "Windcrest, TX", distributor: "Mygrant San Antonio" },
      HOUSTON: { branch: "Houston, TX", distributor: "Mygrant Houston" },
    },
    partes: ["Mygrant Austin", "Mygrant Irving", "Mygrant San Antonio", "Mygrant Houston", "Mygrant Carrolton"],
    filas: filasDe(`01/05/2025	I04527973-0	-148.69	AUSTIN
01/05/2025	I04527972-0	104.43	IRVING
01/05/2025	I04527974-0	58.80	SAN ANTONIO
01/12/2025	I04531040-0	83.09	AUSTIN
01/12/2025	I04531039-0	251.42	IRVING
01/12/2025	I04531041-0	690.82	SAN ANTONIO
01/19/2025	I04539068-0	1,245.83	AUSTIN
01/19/2025	I04539067-0	600.24	IRVING
01/19/2025	I04539069-0	319.62	SAN ANTONIO
01/26/2025	I04542469-0	-296.14	AUSTIN
01/26/2025	I04542468-0	394.98	AUSTIN
01/26/2025	I04542467-0	89.44	IRVING
01/26/2025	I04542471-0	-98.59	SAN ANTONIO
01/26/2025	I04542470-0	1,077.76	SAN ANTONIO
01/31/2025	I04545892-0	-323.58	AUSTIN
01/31/2025	I04545891-0	105.78	AUSTIN
01/31/2025	I04545890-0	-201.01	IRVING
01/31/2025	I04545889-0	554.23	IRVING
01/31/2025	I04545895-0	156.80	HOUSTON
01/31/2025	I04545894-0	-75.29	SAN ANTONIO
01/31/2025	I04545893-0	659.42	SAN ANTONIO
02/02/2025	I04552860-0	29.82	IRVING
02/09/2025	I04555197-0	395.22	AUSTIN
02/09/2025	I04555196-0	869.67	IRVING
02/09/2025	I04555200-0	252.14	HOUSTON
02/09/2025	I04555199-0	-106.30	SAN ANTONIO
02/09/2025	I04555198-0	934.13	SAN ANTONIO
02/16/2025	I04563613-0	-250.62	IRVING
02/16/2025	I04563612-0	620.53	IRVING
02/16/2025	I04563614-0	231.15	SAN ANTONIO
02/23/2025	I04567046-0	-62.47	AUSTIN
02/23/2025	I04567045-0	332.66	AUSTIN
02/23/2025	I04567044-0	-55.13	IRVING
02/23/2025	I04567043-0	772.77	IRVING
02/23/2025	I04567048-0	-90.62	SAN ANTONIO
02/23/2025	I04567047-0	107.68	SAN ANTONIO
02/28/2025	I04570658-0	766.89	AUSTIN
02/28/2025	I04570657-0	239.12	IRVING
02/28/2025	I04570659-0	1,672.48	SAN ANTONIO
03/02/2025	I04577557-0	-98.17	IRVING
03/09/2025	I04580073-0	897.52	AUSTIN
03/09/2025	I04580072-0	503.88	IRVING
03/09/2025	I04580075-0	196.70	HOUSTON
03/09/2025	I04580074-0	151.89	SAN ANTONIO
03/16/2025	I04588697-0	906.05	AUSTIN
03/16/2025	I04588696-0	1,008.39	IRVING
03/16/2025	I04588699-0	-109.00	SAN ANTONIO
03/16/2025	I04588698-0	1,083.65	SAN ANTONIO
03/23/2025	I04592240-0	184.00	AUSTIN
03/23/2025	I04592239-0	-66.31	IRVING
03/23/2025	I04592238-0	927.01	IRVING
03/23/2025	I04592241-0	1,054.38	SAN ANTONIO
03/30/2025	I04595747-0	599.74	AUSTIN
03/30/2025	I04595746-0	488.55	IRVING
03/30/2025	I04595749-0	-339.41	SAN ANTONIO
03/30/2025	I04595748-0	909.65	SAN ANTONIO
03/31/2025	I04597925-0	216.53	AUSTIN
03/31/2025	I04597924-0	208.96	IRVING
04/06/2025	I04606181-0	-438.38	AUSTIN
04/06/2025	I04606180-0	2,010.23	AUSTIN
04/06/2025	I04606179-0	412.58	IRVING
04/06/2025	I04606182-0	932.17	SAN ANTONIO
04/13/2025	I04610166-0	-420.82	AUSTIN
04/13/2025	I04610165-0	387.45	AUSTIN
04/13/2025	I04610164-0	461.20	IRVING
04/13/2025	I04610167-0	1,023.84	SAN ANTONIO
04/20/2025	I04619670-0	-95.91	AUSTIN
04/20/2025	I04619669-0	398.90	AUSTIN
04/20/2025	I04619668-0	200.51	IRVING
04/20/2025	I04619671-0	489.99	SAN ANTONIO
04/27/2025	I04623679-0	224.76	AUSTIN
04/27/2025	I04623678-0	531.17	IRVING
04/27/2025	I04623680-0	1,097.83	SAN ANTONIO
04/30/2025	I04626890-0	456.29	AUSTIN
04/30/2025	I04626891-0	355.48	SAN ANTONIO
04/30/2025	I04626889-0	102.58	IRVING
05/04/2025	I04635067-0	-81.83	AUSTIN
05/04/2025	I04635066-0	505.26	AUSTIN
05/04/2025	I04635065-0	341.72	IRVING
05/04/2025	I04635068-0	351.90	SAN ANTONIO
05/11/2025	I04638811-0	-116.59	AUSTIN
05/11/2025	I04638810-0	339.76	AUSTIN
05/11/2025	I04638809-0	-21.00	IRVING
05/11/2025	I04638808-0	752.23	IRVING
05/11/2025	I04638813-0	-202.86	SAN ANTONIO
05/11/2025	I04638812-0	1,376.64	SAN ANTONIO
05/18/2025	I04648364-0	577.30	HOUSTON
05/25/2025	I04652321-0	244.88	HOUSTON
05/31/2025	I04656105-0	-244.88	HOUSTON
05/31/2025	I04656104-0	441.05	HOUSTON
05/18/2025	I04648363-0	-101.43	SAN ANTONIO
05/18/2025	I04648362-0	542.56	SAN ANTONIO
05/18/2025	I04648361-0	-155.14	AUSTIN
05/18/2025	I04648360-0	533.23	AUSTIN
05/18/2025	I04648359-0	1,031.14	IRVING
05/25/2025	I04652318-0	286.32	AUSTIN
05/25/2025	I04652317-0	473.07	IRVING
05/25/2025	I04652320-0	-74.50	SAN ANTONIO
05/25/2025	I04652319-0	462.70	SAN ANTONIO
05/31/2025	I04656102-0	-179.42	AUSTIN
05/31/2025	I04656101-0	-108.60	IRVING
05/31/2025	I04656100-0	1,280.89	IRVING
05/31/2025	I04656103-0	1,045.71	SAN ANTONIO
06/08/2025	I04665665-0	258.81	AUSTIN
06/08/2025	I04665664-0	2,104.89	IRVING
06/08/2025	I04665668-0	-284.97	HOUSTON
06/08/2025	I04665667-0	550.12	HOUSTON
06/08/2025	I04665666-0	191.19	SAN ANTONIO
06/15/2025	I04669072-0	-110.46	AUSTIN
06/15/2025	I04669071-0	864.43	AUSTIN
06/15/2025	I04669070-0	1,189.54	IRVING
06/15/2025	I04669073-0	421.98	SAN ANTONIO
06/22/2025	I04677782-0	567.83	AUSTIN
06/22/2025	I04677781-0	1,042.53	IRVING
06/22/2025	I04677783-0	1,658.48	SAN ANTONIO
06/29/2025	I04681310-0	-73.51	AUSTIN
06/29/2025	I04681309-0	223.93	AUSTIN
06/29/2025	I04681308-0	-64.96	IRVING
06/29/2025	I04681307-0	1,326.17	IRVING
06/29/2025	I04681312-0	-44.59	SAN ANTONIO
06/29/2025	I04681311-0	1,106.72	SAN ANTONIO
06/30/2025	I04683286-0	148.40	IRVING
06/30/2025	I04683287-0	170.64	SAN ANTONIO
07/06/2025	I04689430-0	1,439.25	AUSTIN
07/06/2025	I04689429-0	-155.85	IRVING
07/06/2025	I04689428-0	632.76	IRVING
07/06/2025	I04689432-0	156.00	HOUSTON
07/06/2025	I04689431-0	664.72	SAN ANTONIO
07/13/2025	I04692150-0	974.99	AUSTIN
07/13/2025	I04692149-0	-102.58	IRVING
07/13/2025	I04692148-0	971.38	IRVING
07/13/2025	I04692152-0	73.52	HOUSTON
07/13/2025	I04692151-0	831.26	SAN ANTONIO
07/20/2025	I04709167-0	39.85	HOUSTON
07/20/2025	I04709166-0	442.60	SAN ANTONIO
07/27/2025	I04713460-0	102.67	HOUSTON
07/20/2025	I04709163-0	2,130.60	IRVING
07/20/2025	I04709164-0	-474.91	IRVING
07/31/2025	I04717470-0	207.18	IRVING
07/27/2025	I04713459-0	671.57	SAN ANTONIO
07/31/2025	I04717473-0	438.56	SAN ANTONIO
07/27/2025	I04713457-0	779.36	IRVING
07/27/2025	I04713458-0	302.06	AUSTIN
07/31/2025	I04717471-0	188.97	AUSTIN
07/20/2025	I04709165-0	1,286.10	AUSTIN
07/31/2025	I04717472-0	-36.93	AUSTIN
08/03/2025	I04725677-0	111.00	AUSTIN
08/03/2025	I04725676-0	97.00	IRVING
08/03/2025	I04725679-0	-434.56	SAN ANTONIO
08/03/2025	I04725678-0	235.99	SAN ANTONIO
08/10/2025	I04729643-0	627.89	AUSTIN
08/10/2025	I04729642-0	-187.00	IRVING
08/10/2025	I04729641-0	641.20	IRVING
08/10/2025	I04729645-0	149.84	HOUSTON
08/10/2025	I04729644-0	993.25	SAN ANTONIO
08/17/2025	I04739681-0	689.01	AUSTIN
08/17/2025	I04739680-0	-81.44	IRVING
08/17/2025	I04739679-0	360.85	IRVING
08/17/2025	I04739683-0	149.84	HOUSTON
08/17/2025	I04739682-0	326.12	SAN ANTONIO
08/24/2025	I04744135-0	654.93	AUSTIN
08/24/2025	I04744134-0	-65.92	IRVING
08/24/2025	I04744133-0	615.91	IRVING
08/24/2025	I04744137-0	157.00	HOUSTON
08/24/2025	I04744136-0	1,231.49	SAN ANTONIO
08/27/2025	I04746866-0	-69.00	AUSTIN
08/27/2025	I04746865-0	575.80	AUSTIN
08/27/2025	I04746864-0	262.03	IRVING
08/27/2025	I04746868-0	-149.84	HOUSTON
08/27/2025	I04746867-0	310.00	SAN ANTONIO
08/31/2025	I04748697-0	183.00	IRVING
09/07/2025	I04758182-0	430.19	IRVING
09/07/2025	I04758183-0	971.94	AUSTIN
09/07/2025	I04758185-0	-113.00	SAN ANTONIO
09/07/2025	I04758184-0	1,161.50	SAN ANTONIO
09/14/2025	I04762013-0	-113.00	AUSTIN
09/14/2025	I04762012-0	220.00	AUSTIN
09/14/2025	I04762011-0	746.71	IRVING
09/14/2025	I04762015-0	328.00	HOUSTON
09/14/2025	I04762014-0	308.41	SAN ANTONIO
09/21/2025	I04771661-0	-138.12	AUSTIN
09/21/2025	I04771660-0	677.17	AUSTIN
09/21/2025	I04771659-0	-118.00	IRVING
09/21/2025	I04771658-0	505.80	IRVING
09/21/2025	I04771662-0	741.84	SAN ANTONIO
09/28/2025	I04775505-0	644.17	AUSTIN
09/28/2025	I04775504-0	334.98	IRVING
09/28/2025	I04775507-0	54.23	HOUSTON
09/28/2025	I04775506-0	969.16	SAN ANTONIO
09/30/2025	I04778103-0	123.00	AUSTIN
09/30/2025	I04778102-0	83.16	IRVING
09/30/2025	I04778104-0	39.00	SAN ANTONIO
10/05/2025	I04786753-0	59.00	IRVING
10/05/2025	I04786755-0	-171.42	SAN ANTONIO
10/05/2025	I04786754-0	171.42	SAN ANTONIO
10/12/2025	I04790344-0	-86.79	AUSTIN
10/12/2025	I04790343-0	86.79	AUSTIN
10/12/2025	I04790346-0	-226.00	SAN ANTONIO
10/12/2025	I04790345-0	582.37	SAN ANTONIO
10/12/2025	I04790342-0	362.50	IRVING
10/19/2025	I04799994-0	381.52	AUSTIN
10/19/2025	I04799993-0	394.28	IRVING
10/19/2025	I04799995-0	266.93	SAN ANTONIO
10/26/2025	I04803782-0	-95.25	AUSTIN
10/26/2025	I04803781-0	162.86	AUSTIN
10/26/2025	I04803780-0	158.26	IRVING
10/26/2025	I04803783-0	412.26	SAN ANTONIO
10/31/2025	I04807559-0	183.04	AUSTIN
10/31/2025	I04807558-0	-50.95	IRVING
10/31/2025	I04807557-0	563.95	IRVING
10/31/2025	I04807560-0	133.18	SAN ANTONIO
11/09/2025	I04817772-0	506.50	AUSTIN
11/09/2025	I04817771-0	347.60	IRVING
11/09/2025	I04817773-0	675.25	SAN ANTONIO
11/16/2025	I04827224-0	87.81	AUSTIN
11/16/2025	I04827223-0	-191.74	IRVING
11/16/2025	I04827222-0	848.00	IRVING
11/16/2025	I04827225-0	748.37	SAN ANTONIO
11/23/2025	I04830997-0	370.20	AUSTIN
11/23/2025	I04830996-0	-66.50	IRVING
11/23/2025	I04830995-0	143.83	IRVING
11/23/2025	I04830998-0	442.00	SAN ANTONIO
11/30/2025	I04834396-0	773.38	AUSTIN
11/30/2025	I04834395-0	233.09	IRVING
11/30/2025	I04834397-0	70.73	SAN ANTONIO
12/07/2025	I04843458-0	-161.50	AUSTIN
12/07/2025	I04843457-0	231.50	AUSTIN
12/07/2025	I04843456-0	323.43	IRVING
12/07/2025	I04843459-0	209.23	SAN ANTONIO
12/14/2025	I04847248-0	55.50	AUSTIN
12/14/2025	I04847247-0	865.86	IRVING
12/14/2025	I04847250-0	391.35	HOUSTON
12/14/2025	I04847249-0	334.54	SAN ANTONIO
12/21/2025	I04856671-0	161.53	AUSTIN
12/21/2025	I04856670-0	177.39	IRVING
12/21/2025	I04856673-0	156.88	HOUSTON
12/21/2025	I04856672-0	92.50	SAN ANTONIO
12/28/2025	I04859821-0	142.51	AUSTIN
12/28/2025	I04859820-0	462.38	IRVING
12/28/2025	I04859823-0	41.22	HOUSTON
12/28/2025	I04859822-0	106.26	SAN ANTONIO
12/31/2025	I04862639-0	-65.50	IRVING
12/31/2025	I04862640-0	234.50	SAN ANTONIO`),
  },
];

// ---------------------------------------------------------------------------------------------
function sucursalDe(region, fila) {
  if (fila[3] && region.sucursales?.[fila[3]]) return region.sucursales[fila[3]];
  return { branch: region.branch, distributor: region.distributor };
}
function branchesDe(region) {
  return region.sucursales ? Object.values(region.sucursales).map((x) => x.branch) : [region.branch];
}
async function paso1_registrar(region) {
  titulo(`1. ${region.nombre}: registrar ${region.filas.length} facturas (${fmt(region.filas.reduce((s, x) => s + num(x[2]), 0))})`);
  const db = new Map((await pool.query("SELECT * FROM distributor_statement WHERE active")).rows.map((r) => [r.invoice_number.toUpperCase(), r]));
  const crear = [], ok = [], conflicto = [], sucursal = [];
  for (const fila of region.filas) {
    const [fecha, inv, montoCrudo] = fila;
    const suc = sucursalDe(region, fila);
    const monto = money(num(montoCrudo));
    const r = db.get(inv.toUpperCase());
    if (!r) { crear.push({ fecha, inv, monto, suc }); continue; }
    if (!eq(r.amount, monto)) { conflicto.push({ inv, nuestro: Number(r.amount), mygrant: monto }); continue; }
    ok.push(r);
    // Sin sucursal, o con la etiqueta genérica de la región ("Texas") en vez de la sucursal real:
    // el cruce por lote busca la sucursal exacta (Irving, Houston, Windcrest), así que se corrige.
    if (r.branch !== suc.branch || r.distributor !== suc.distributor) sucursal.push({ r, suc });
  }
  log(`  Ya existen y coinciden: ${ok.length} (${sucursal.length} con sucursal o distribuidor por corregir)`);
  log(`  Nuevas: ${crear.length} por $${fmt(crear.reduce((s, x) => s + x.monto, 0))}`);
  for (const x of conflicto) log(`  CONFLICTO ${x.inv}: nosotros $${fmt(x.nuestro)}, Mygrant $${fmt(x.mygrant)} — no se toca`);
  if (!APPLY) return;
  for (const x of crear) {
    await pool.query(
      `INSERT INTO distributor_statement
         (invoice_number, distributor, branch, kind, issue_date, due_date, amount, paid_amount, status, terms_days, source, notes)
       VALUES ($1,$2,$3,$4,$5::date,$5::date + 60,$6,0,'paid',60,'resumen_mygrant_2025',$7)
       ON CONFLICT DO NOTHING`,
      [x.inv, region.distributor, region.branch, x.monto < 0 ? "CREDIT_MEMO" : "INVOICE", iso(x.fecha), x.monto,
        `Del resumen 2025 de Mygrant (${region.nombre}), pasado por Antonio el 4-sep-2026. 2025 cerrado: pagada, falta amarrar el lote.`]);
  }
  for (const { r, suc } of sucursal) {
    if (r.payout_id) {
      // Amarrada a un lote: solo la sucursal, el distribuidor de una factura pagada es historia.
      await pool.query("UPDATE distributor_statement SET branch = $2, updated_at = now() WHERE id = $1", [r.id, suc.branch]);
    } else {
      await pool.query("UPDATE distributor_statement SET branch = $2, distributor = $3, updated_at = now() WHERE id = $1", [r.id, suc.branch, suc.distributor]);
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Paquete = todas las facturas y memos de una misma fecha. Un pago normalmente cubre semanas
// seguidas, así que primero se prueban rangos contiguos; si no hay, subconjuntos chicos. Solo se
// acepta una solución única.
async function paso2_amarrar(region) {
  titulo(`2. ${region.nombre}: amarrar paquetes a lotes`);
  const invs = region.filas.map((x) => x[1]);
  const st = (await pool.query(
    `SELECT id, invoice_number, issue_date::text d, amount::float amt, payout_id, branch FROM distributor_statement
      WHERE active AND (invoice_number = ANY($1) OR (branch = $2 AND issue_date >= '2025-01-01' AND issue_date < '2026-01-01'))
      ORDER BY issue_date, invoice_number`, [invs, region.branch])).rows;
  // En modo reporte las facturas nuevas aún no existen: se simulan con las del resumen.
  if (!APPLY) {
    const enDb = new Set(st.map((x) => x.invoice_number.toUpperCase()));
    for (const f of region.filas) if (!enDb.has(f[1].toUpperCase())) st.push({ id: null, invoice_number: f[1], d: iso(f[0]), amt: money(num(f[2])), payout_id: null });
    st.sort((a, b) => a.d.localeCompare(b.d) || a.invoice_number.localeCompare(b.invoice_number));
  }
  const libres = st.filter((s) => !s.payout_id);
  const packets = [];
  for (const s of libres) {
    let pk = packets.find((p) => p.d === s.d);
    if (!pk) { pk = { d: s.d, items: [], amt: 0 }; packets.push(pk); }
    pk.items.push(s); pk.amt = money(pk.amt + s.amt);
  }
  const lotes = (await pool.query(
    `SELECT o.id, o.payment_number pn, o.payment_date::text d, o.total_amount::float tot, o.invoices,
            (SELECT string_agg(DISTINCT btrim(party), ', ') FROM payable WHERE payout_id=o.id) partes
       FROM payouts o
      WHERE o.type='DISTRIBUTOR' AND o.active<>false AND o.status<>'Cancelled'
        AND o.payment_date::date >= '2025-01-01' AND o.payment_date::date < '2026-04-01'
        AND NOT EXISTS (SELECT 1 FROM distributor_statement s WHERE s.payout_id=o.id AND s.active)
        AND EXISTS (SELECT 1 FROM payable pb WHERE pb.payout_id=o.id AND btrim(pb.party) = ANY($1))
      ORDER BY o.payment_date`, [region.partes])).rows;
  log(`  Paquetes libres: ${packets.length} ($${fmt(packets.reduce((s, p) => s + p.amt, 0))}) | lotes de la región sin statement: ${lotes.length} ($${fmt(lotes.reduce((s, l) => s + l.tot, 0))})`);
  const usados = new Set();
  const amarres = [];
  for (const L of lotes) {
    const cand = packets.filter((p) => !usados.has(p.d) && p.d <= L.d);
    const T = Math.round(L.tot * 100);
    const sols = [];
    // rangos contiguos
    for (let i = 0; i < cand.length; i++) {
      let sum = 0;
      for (let j = i; j < cand.length && j < i + 10; j++) {
        sum += Math.round(cand[j].amt * 100);
        if (sum === T) sols.push(cand.slice(i, j + 1));
      }
    }
    let sol = null, tipo = "contiguo";
    if (sols.length === 1) sol = sols[0];
    else if (sols.length === 0 && cand.length <= 40) {
      const subs = [];
      (function rec(i, sum, ch) {
        if (subs.length > 1) return;
        if (sum === T && ch.length) { subs.push([...ch]); return; }
        if (i >= cand.length || ch.length >= 5) return;
        ch.push(cand[i]); rec(i + 1, sum + Math.round(cand[i].amt * 100), ch); ch.pop();
        rec(i + 1, sum, ch);
      })(0, 0, []);
      if (subs.length === 1) { sol = subs[0]; tipo = "subconjunto"; }
      else if (subs.length > 1) tipo = "ambiguo";
    } else if (sols.length > 1) tipo = "ambiguo";
    if (sol) {
      sol.forEach((p) => usados.add(p.d));
      amarres.push({ L, sol });
      log(`  ${L.pn} ${L.d} $${fmt(L.tot)} = ${sol.map((p) => p.d + " $" + fmt(p.amt)).join(" + ")} (${tipo})`);
    } else {
      log(`  ${L.pn} ${L.d} $${fmt(L.tot)} [${L.partes}] — sin cuadre (${tipo === "ambiguo" ? "varias combinaciones posibles" : "ninguna combinación"})`);
    }
  }
  const sobran = packets.filter((p) => !usados.has(p.d));
  log(`  -> ${amarres.length} lotes amarrados, ${sobran.length} paquetes sin lote (${fmt(sobran.reduce((s, p) => s + p.amt, 0))}): ${sobran.map((p) => p.d).join(", ")}`);
  if (APPLY) for (const { L, sol } of amarres) await amarrar(L, sol.flatMap((p) => p.items));
  const amarrados = new Set(amarres.map((a) => a.L.id));
  return { sobrantes: sobran.flatMap((p) => p.items), lotes: lotes.filter((l) => !amarrados.has(l.id)) };
}

async function amarrar(L, items) {
  await statementsStore.applyToPayout(items.map((s) => s.id), L.id, {});
  if (!Array.isArray(L.invoices) || L.invoices.length === 0) {
    const invoices = items.map((s) => ({ number: s.invoice_number, date: s.d, amount: money(s.amt) }));
    await pool.query("UPDATE payouts SET invoices = $2::jsonb, invoice_total = $3, updated_at = now(), updated_by = $4 WHERE id = $1",
      [L.id, JSON.stringify(invoices), money(invoices.reduce((s, i) => s + i.amount, 0)), ACTOR]);
  }
}

// ---------------------------------------------------------------------------------------------
// Paso 3: lo que sobró, a nivel factura y cruzando regiones. Dos casos reales: un lote que paga
// Sur y Norte de California juntos (Dist-0054, 0056, 0058, 0082, 0084), y en Texas un lote que
// paga una sola sucursal de la semana (Dist-0137 = Irving del 20-jul y 31-jul). Se acepta solo
// la solución única entre las facturas de las sucursales a las que ese lote les paga.
const BRANCH_DE_PARTE = {
  "Mygrant Anaheim": "Newport Beach", "Mygrant Compton": "Newport Beach", "Mygrant Riverside": "Newport Beach",
  "Mygrant San Fernando": "Newport Beach", "Mygrant La Puente": "Newport Beach",
  "Mygrant Hayward": "Fresno", "Mygrant Sacramento": "Fresno", "Mygrant San Jose": "Fresno", "Mygrant Oakland": "Fresno",
  "Mygrant Martinez": "Fresno", "Mygrant San Francisco": "Fresno",
  "Mygrant Austin": "Austin, TX", "Mygrant Irving": "Irving, TX", "Mygrant Carrolton": "Irving, TX",
  "Mygrant San Antonio": "Windcrest, TX", "Mygrant Houston": "Houston, TX",
};
async function paso3_sobrantes(sobrantes, lotes) {
  titulo("3. Sobrantes: a nivel factura, cruzando regiones");
  const branchDe = new Map();
  for (const st of sobrantes) {
    const f = REGIONES.flatMap((r) => r.filas.map((x) => [x, r])).find(([x]) => x[1].toUpperCase() === st.invoice_number.toUpperCase());
    if (f) st.branch = sucursalDe(f[1], f[0]).branch;
    branchDe.set(st.invoice_number, st.branch);
  }
  const usados = new Set();
  const vistos = new Set();
  const pendientes = lotes.filter((l) => !vistos.has(l.id) && vistos.add(l.id)).sort((a, b) => a.d.localeCompare(b.d));
  let n = 0, monto = 0;
  for (const L of pendientes) {
    const branches = new Set(String(L.partes || "").split(",").map((x) => x.trim()).map((x) => BRANCH_DE_PARTE[x]).filter(Boolean));
    // Grupo = misma fecha y misma sucursal (la factura con su memo de crédito). Se toma completo
    // o no se toma: mezclar una factura sin su memo da coincidencias numéricas que no son pagos.
    const grupos = [];
    for (const st of sobrantes.filter((st) => !usados.has(st.invoice_number) && st.d <= L.d && branches.has(st.branch))) {
      let g = grupos.find((x) => x.d === st.d && x.branch === st.branch);
      if (!g) { g = { d: st.d, branch: st.branch, items: [], amt: 0 }; grupos.push(g); }
      g.items.push(st); g.amt = money(g.amt + st.amt);
    }
    grupos.sort((a, b) => a.d.localeCompare(b.d));
    const cand = grupos;
    const T = Math.round(L.tot * 100);
    const sols = [];
    (function rec(i, sum, ch) {
      if (sols.length > 1) return;
      if (sum === T && ch.length) { sols.push([...ch]); return; }
      if (i >= cand.length || ch.length >= 6) return;
      ch.push(cand[i]); rec(i + 1, sum + Math.round(cand[i].amt * 100), ch); ch.pop();
      rec(i + 1, sum, ch);
    })(0, 0, []);
    if (sols.length === 1) {
      const sol = sols[0].flatMap((g) => g.items);
      sol.forEach((st) => usados.add(st.invoice_number));
      n++; monto += L.tot;
      log(`  ${L.pn} ${L.d} ${fmt(L.tot)} = ${sol.map((st) => st.invoice_number + " " + st.d + " " + st.branch + " $" + fmt(st.amt)).join(" + ")}`);
      if (APPLY) await amarrar(L, sol);
    } else {
      log(`  ${L.pn} ${L.d} ${fmt(L.tot)} [${L.partes}] — ${sols.length > 1 ? "varias combinaciones" : "ninguna combinación"} entre ${cand.length} facturas de ${[...branches].join("/")}`);
    }
  }
  const quedan = sobrantes.filter((st) => !usados.has(st.invoice_number));
  log(`  -> ${n} lotes amarrados (${fmt(monto)}); facturas que quedan sin lote: ${quedan.length} (${fmt(quedan.reduce((s, x) => s + x.amt, 0))})`);
  for (const st of quedan) log(`     ${st.invoice_number} ${st.d} ${st.branch || "?"} ${fmt(st.amt)}`);
}

// ---------------------------------------------------------------------------------------------
async function verificacion(region) {
  titulo(`Verificación ${region.nombre}`);
  const r = (await pool.query(
    `SELECT count(*)::int n, sum(amount)::float total, count(*) FILTER (WHERE payout_id IS NOT NULL)::int con_lote,
            sum(amount) FILTER (WHERE payout_id IS NOT NULL)::float total_con_lote
       FROM distributor_statement WHERE active AND branch = $1 AND issue_date >= '2025-01-01' AND issue_date < '2026-01-01'`, [region.branch])).rows[0];
  log(`  Statements 2025 de ${region.branch}: ${r.n} por $${fmt(r.total)}; con lote ${r.con_lote} por $${fmt(r.total_con_lote)}; sin lote $${fmt(r.total - r.total_con_lote)}`);
  const l = (await pool.query(
    `SELECT o.payment_number, o.payment_date::text d, o.total_amount::float tot FROM payouts o
      WHERE o.type='DISTRIBUTOR' AND o.active<>false AND o.status<>'Cancelled' AND o.payment_date::date >= '2025-01-01' AND o.payment_date::date < '2026-01-01'
        AND NOT EXISTS (SELECT 1 FROM distributor_statement s WHERE s.payout_id=o.id AND s.active)
        AND EXISTS (SELECT 1 FROM payable pb WHERE pb.payout_id=o.id AND btrim(pb.party) = ANY($1)) ORDER BY o.payment_date`, [region.partes])).rows;
  log(`  Lotes 2025 de la región que siguen sin statement: ${l.length} ($${fmt(l.reduce((s, x) => s + x.tot, 0))})`);
  for (const x of l) log(`     ${x.payment_number} ${x.d} $${fmt(x.tot)}`);
}

(async () => {
  log(`Resumen Mygrant 2025 — ${APPLY ? "APLICANDO" : "SOLO REPORTE"} — ${new Date().toISOString()}`);
  for (const region of REGIONES) await paso1_registrar(region);
  const sobrantes = [], lotes = [];
  for (const region of REGIONES) {
    const r = await paso2_amarrar(region);
    sobrantes.push(...r.sobrantes); lotes.push(...r.lotes);
  }
  await paso3_sobrantes(sobrantes, lotes);
  for (const region of REGIONES) await verificacion(region);
  const out = path.join(__dirname, "..", "backups", `resumen-mygrant-2025-${APPLY ? "apply" : "reporte"}-${new Date().toISOString().slice(0, 10)}.txt`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, informe.join("\n"));
  console.log(`\nInforme guardado en ${out}`);
  await pool.end();
})().catch(async (e) => { console.error("\nERROR:", e.stack || e.message); try { await pool.end(); } catch {} process.exit(1); });
