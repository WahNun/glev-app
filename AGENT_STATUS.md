STATUS: DONE
LAST_DONE: Stripe Checkout Fix — neue Server Actions submitProCheckout/submitBetaCheckout (nur FormData-Signatur) direkt am `<form action={…}>` verkabelt. useActionState-Wrapper raus, Pending-State über useFormStatus-Subkomponente, Errors via ?error=, Beta-Capacity via ?full=1. Dadurch hat das Form jetzt schon zur SSR-Zeit ein action-Attribut und Submits funktionieren auch vor Hydration.
NEXT: Im Browser /pro und /beta testen — Email eingeben, Submit, sollte zu checkout.stripe.com weiterleiten. Bei Fehler: ?error=… in der URL und rote Fehlermeldung sichtbar.
QUESTION:
TIMESTAMP: 00:14
