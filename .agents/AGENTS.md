# Playbook de Arquitectura de Korion Loan

Este documento es la **única fuente de verdad técnica y operativa** para el desarrollo y mantenimiento del sistema de préstamos Korion Loan. Todos los desarrolladores y asistentes automáticos de desarrollo deben adherirse estrictamente a estas pautas de diseño y reglas de negocio.

---

## 1. Lineamientos Fundamentales de Arquitectura

### 1.1. El Frontend es 100% Pasivo ("Capa de Pintura")
- **Cero Cálculos Financieros en el Cliente**: El frontend tiene estrictamente prohibido realizar cálculos de balances, moras, amortizaciones pendientes o totalizaciones de cuotas, así como aplicar fallbacks manuales (`|| 0`) basados en propiedades estáticas de la base de datos.
- **Payload Digerido**: Toda la información contable sensible y agregada de un préstamo o cliente (mora acumulada, balance pendiente, total recaudado, cuotas vencidas, días de atraso) debe ser calculada y enviada pre-masticada desde el backend en el objeto `financialSummary`. El frontend se limita exclusivamente a renderizar lo que reciba de este payload.

### 1.2. Prohibido el Reciclaje de Objetos en Memoria para Vistas Críticas
- **Sin Reutilización de Datos de Listas**: Al abrir una vista de detalle contable o perfil de cliente/préstamo, es mandatorio realizar una consulta fresca e individual al endpoint por ID (`/api/loans/:id` o `/api/clients/:id`).
- **Estado Fresco**: No se deben utilizar los datos abreviados devueltos por los endpoints de listado general (como los del dashboard) para rellenar campos financieros críticos, ya que esto propaga datos obsoletos almacenados en el estado global o en la caché del navegador.

### 1.3. El Servidor es la Única Fuente de Verdad (Single Source of Truth)
- **Cálculos Centralizados**: Las reglas de negocio, el cálculo de moras, las penalizaciones de "Gana Tiempo", los recortes contables y la amortización del calendario se ejecutan del lado del servidor y se graban en la base de datos. Esto asegura que las interrupciones de conexión o errores en el navegador no alteren la consistencia financiera de los datos mostrados.

---

## 2. Mapa de Estructura y Organización del Proyecto

### 2.1. Backend (`/backend`)
*   `index.js`: Archivo de arranque principal del servidor Express. Configura middlewares globales de seguridad (Helmet), CORS, Rate Limit y monta las rutas. *(CORS siempre se declara antes de los limitadores de tráfico para que las respuestas 429 no fallen por cabeceras de origen).*
*   `controllers/`: Controladores encargados de recibir las peticiones HTTP y orquestar la lógica de negocio.
    *   `loanController.js`: Gestión de creación, edición, listado y recalculo de préstamos.
    *   `clientController.js`: Gestión de perfiles de clientes y sus métricas acumuladas.
    *   `financeController.js`: Manejo de cajas, billeteras de fondeo y saldos generales.
*   `engines/`: Motores de cálculo puro aislados de dependencias HTTP y consultas directas a base de datos.
    *   [amortizationEngine.js](file:///home/steven/korion-projects/korion-loan/backend/engines/amortizationEngine.js): Motor de generación de calendarios (amortización) para Cuota Fija, Francés (EMI) y Rédito.
    *   [paymentEngine.js](file:///home/steven/korion-projects/korion-loan/backend/engines/paymentEngine.js): Motor de asignación de abonos a capital, intereses y recargos con reglas de redondeo.
    *   [penaltyEngine.js](file:///home/steven/korion-projects/korion-loan/backend/engines/penaltyEngine.js): Motor de cálculo de moras y mitigaciones de Gana Tiempo.
*   `models/`: Esquemas de Mongoose para la base de datos MongoDB.
    *   `Loan.js`: Esquema unificado de préstamos (V3) que incluye el sub-esquema de cuotas (`schedule`) y la configuración de penalidad (`penaltyConfig`).
    *   `Client.js`: Esquema de clientes con datos personales y balances de deuda global.
    *   `PaymentV2.js`: Historial de transacciones de pago vinculadas a cuotas.
*   `routes/`: Enrutadores de la API REST que conectan los endpoints con sus controladores y middlewares.
*   `middleware/`: Middlewares de seguridad (autenticación JWT, verificación de roles e inyección de filtros de tenant/negocio).
*   `services/`: Servicios en segundo plano (ej. poller del bot de Telegram para notificaciones en tiempo real).

### 2.2. Frontend (`/frontend`)
*   `src/App.jsx`: Enrutador principal de la Single Page Application (SPA).
*   `src/modules/`: Módulos de funcionalidad independientes.
    *   `Loans/`: Gestión de préstamos. Contiene `LoanCalculatorModule.jsx` (dashboard de cartera) y sus componentes secundarios:
        *   `components/LoanDetails.jsx`: Vista detallada contable del préstamo. Hace fetch al endpoint individual al montarse para sincronizar el balance fresco.
        *   `components/LoanForm.jsx`: Formulario de creación y edición con calculadora interactiva integrada.
    *   `Clients/`: Gestión de clientes. Contiene `ClientsModule.jsx` (perfiles de clientes, score y deuda).
    *   `Platform/`: Módulo de administración de negocios (Tenants, licencias y cálculo de MRR).

---

## 3. Diccionario de Estructura de Datos Obligatorio

Para evitar la duplicidad o desalineación de propiedades en los payloads JSON de la API, se define la siguiente nomenclatura estándar obligatoria:

### 3.1. Campos del Préstamo (`Loan` Document)
*   `amount`: El capital inicial prestado (Number).
*   `currentCapital`: El capital pendiente por amortizar (Number).
*   `interestRateMonthly`: La tasa de interés mensual cobrada (%) (Number).
*   `lendingType`: Modelo financiero del préstamo (`'redito'`, `'fixed'`, `'amortization'`).
*   `duration`: Cantidad total de cuotas pactadas (Number).
*   `frequency`: Frecuencia de cobros (`'daily'`, `'weekly'`, `'biweekly'`, `'monthly'`).
*   `frequencyMode`: Sub-configuración de pago para quincenales (`'standard'`, `'15_30'`).
*   `startDate`: Fecha de inicio/desembolso del préstamo (Date).
*   `firstPaymentDate`: Fecha en que vence la primera cuota (Date).
*   `penaltyConfig`: Objeto con la regla de cobro de mora:
    *   `type`: Tipo de recargo (`'fixed'`, `'percent'`).
    *   `value`: El cargo configurado (Number).
    *   `gracePeriod`: Días de prórroga permitidos (Number).
    *   `periodMode`: Intervalo de acumulación (`'daily'`, `'weekly'`, `'biweekly'`, `'monthly'`).
    *   `paidPenalty`: Total de dinero pagado en mora por el cliente (Decimal128).
*   `financialModel`: Objeto con el estado del negocio de intereses:
    *   `interestTotal`: Suma de todos los intereses proyectados a lo largo del préstamo (Number).
    *   `interestPaid`: Suma de intereses efectivamente recaudados hasta hoy (Number).
    *   `interestPending`: Intereses proyectados restantes por cobrar (Number).

### 3.2. Estructura de la Cuota (`schedule` item)
*   `number`: Número correlativo de la cuota (comenzando en 1).
*   `dueDate`: Fecha límite de pago de la cuota (Date).
*   `amount`: Monto total de la cuota (Decimal128).
*   `principalAmount`: Porción correspondiente a amortización de capital (Decimal128).
*   `interestAmount`: Porción correspondiente a cobro de interés (Decimal128).
*   `balance`: Capital pendiente estimado tras pagar esta cuota (Decimal128).
*   `status`: Estado de cobro de la cuota (`'pending'`, `'paid'`, `'partial'`).
*   `paidAmount`: Dinero total abonado a esta cuota en particular (Decimal128).
*   `interestPaid`: Interés pagado en esta cuota (Decimal128).
*   `capitalPaid`: Capital pagado en esta cuota (Decimal128).
*   `paidDate`: Fecha en la que la cuota cambió a estado `paid` (Date).
*   `notes`: Texto auxiliar *(crucial para detectar abonos especiales de mora o marcas como `[Penalidad Aplicada]`)*.

### 3.3. Payload del Resumen Contable (`financialSummary` en el Backend)
Este objeto viaja en `GET /api/loans/:id` y contiene la verdad masticada que renderiza el frontend:
*   `capitalOriginal`: Monto original desembolsado.
*   `interesTotalProyectado`: Sumatoria de intereses del schedule base.
*   `totalPrestamoFinal`: Capital + intereses proyectados totales.
*   `totalRecaudadoGlobal`: Suma de todo el dinero pagado (Capital + Interés + Penalidades).
*   `balanceTotalRestante`: Deuda total pendiente de cobro en la vida del préstamo (Capital + Intereses pendientes).
*   `balanceVencidoAHoy`: Cuotas en mora/atrasadas acumuladas hoy (Capital + Intereses vencidos).
*   `mora`: Mora neta que adeuda hoy el cliente (calculada por el motor de penalidades).
*   `totalVencidoAExigirHoy`: Lo mínimo que debe pagar el cliente hoy para ponerse al día (`balanceVencidoAHoy` + `mora`).
*   `saldoAnticipado`: Dinero total necesario para saldar el préstamo hoy en su totalidad (`balanceTotalRestante` + `mora`).
*   `diasAtraso`: Cantidad de días transcurridos desde el vencimiento de la cuota en mora más antigua.
*   `cuotasVencidasCount`: Cantidad de cuotas actualmente vencidas.
*   `effectiveStatus`: El estado real del préstamo, considerando mitigaciones por Gana Tiempo.

---

## 4. Formulación de Ecuaciones Financieras y Reglas de Negocio

El backend ejecuta los siguientes cálculos estandarizados para mantener la consistencia contable:

### 4.1. Tasa Periódica y Frecuencia Semanal
Dado que los cobros pueden ser en distintas frecuencias, la tasa mensual (`interestRateMonthly`) se convierte a una tasa periódica (`r`) para calcular los intereses de cada cuota:
*   **Mensual:** $r = \text{tasaMonthly} / 100$
*   **Quincenal:** $r = (\text{tasaMonthly} / 100) / 2$
*   **Semanal:** $r = (\text{tasaMonthly} / 100) / 4$
*   **Diario:** $r = (\text{tasaMonthly} / 100) / 30$

### 4.2. Ecuación de Cuota Fija (Flat Interest)
En el modelo de cuota fija (`lendingType === 'fixed'`), el capital se distribuye equitativamente entre las cuotas, y los intereses de cada periodo se calculan de manera estática sobre el capital original del préstamo (sin amortizar saldo):
$$\text{Porción Capital} = \frac{\text{Monto Prestado}}{\text{Cantidad Cuotas}}$$
$$\text{Porción Interés} = \text{Monto Prestado} \times r$$
$$\text{Cuota Total (Quota)} = \text{Porción Capital} + \text{Porción Interés}$$

### 4.3. Reglas de Cálculo y Mitigación de Mora
El motor de mora (`penaltyEngine.js`) se ejecuta diariamente y al consultar un préstamo. Sigue este flujo de cálculo:
1.  **Días de Gracia:** La mora no se cobra hasta que transcurran los días de gracia.
    $$\text{Fecha Límite Gracia} = \text{Fecha Vencimiento} + \text{Días de Gracia}$$
2.  **Periodos en Mora:** Si la fecha actual supera la Fecha Límite de Gracia, se calculan los días vencidos y se convierten en periodos según la frecuencia de la mora (`periodMode`):
    *   **Diario:** Se cobra un factor por cada día de retraso.
    *   **Semanal:** Se cobra 1 periodo inmediatamente al vencer la gracia, y se suma otro por cada 7 días adicionales.
    *   **Quincenal:** 1 periodo de inmediato, sumando otro cada 15 días adicionales.
    *   **Mensual:** 1 periodo de inmediato, sumando otro cada 30 días adicionales.
3.  **Lógica de Seguro (Gana Tiempo):** Si un cliente consume un "Gana Tiempo" (Shift Schedule), la penalidad cobrada se asocia a la cuota como pagada con nota `[Penalidad Aplicada]`. El motor cuenta cuántos abonos de seguro existen y **excluye** las cuotas vencidas más antiguas de la penalización de mora en una relación de 1 a 1.
4.  **Límite de Mora (`maxPenalty`):** Si el total de mora calculada supera el límite máximo configurado para el préstamo, la mora se congela en dicho límite.

### 4.4. Tolerancia de Redondeo de Pagos (RD$10.00)
Para evitar que queden cuotas con saldos pendientes insignificantes (centavos, 5 o 10 pesos) por diferencias en redondeos o abonos inexactos del cliente:
*   Si el abono del cliente (`remainingPayment`) es menor al total de la cuota pendiente pero es **mayor o igual a la cuota menos 10 pesos**:
    $$\text{Condición:} \quad \text{Monto Abonado} \ge (\text{Cuota Pendiente} - 10.00)$$
*   El motor de pagos asume el cobro como **completo** (registra el pago total contable de capital e intereses en el schedule) y cambia el estado de la cuota a **`paid` (Pagada)** en lugar de `partial`. La diferencia restante se condona de forma inmutable.

---

## 5. Mantenimiento del Playbook
Este playbook es un **documento vivo**. Si se altera la base de datos, se añade un endpoint crítico, se modifica la forma en que se amortizan las cuotas o se introduce una nueva regla financiera, **es obligatorio** actualizar este archivo en el mismo commit o Pull Request que introduce el cambio en el código.
