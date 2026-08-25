"use client";

import { useEffect } from "react";
import { useRouter } from "@/i18n/navigation";

// El armado de lotes vive en /dashboard/payments/payable. Esta ruta se conserva solo para que un
// enlace guardado no caiga en un 404.
//
// El wizard que estaba aqui seleccionaba WORK ORDERS, y la deuda es por orden Y por parte: 490
// ordenes tienen mas de una obligacion de distribuidor y 44 le deben a dos distribuidores
// distintos, algo que una lista de ordenes no puede expresar. fb6c84e movio el armado a las
// obligaciones y dejo el wizard en pie "hasta probarlo en uso"; lo que quedo probado es que no
// funcionaba — su listado llamaba a claimedWorkOrderIds(), que esa misma commit habia borrado, y
// aunque hubiera listado, enviaba workOrderIds cuando create() exige payableIds. Ninguno de los
// 791 lotes salio de el: todos vienen del import.
export default function CreatePaymentRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/dashboard/payments/payable");
  }, [router]);
  return null;
}
