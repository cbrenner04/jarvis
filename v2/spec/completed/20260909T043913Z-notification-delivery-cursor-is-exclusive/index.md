# Notification delivery cursor is exclusive

`listDeliveredNotificationIncidents` compares `(delivered_at, incident_id, transition) >= cursor`, so `notifications wait --since <deliveryCursor>` re-delivers the incident that produced the cursor forever and the documented chaining wake path is a fixed point.

- [x] [00 - Exclusive delivery-cursor bound](./00-exclusive-delivery-cursor-bound.md)
