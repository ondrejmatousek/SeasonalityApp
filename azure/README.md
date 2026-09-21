# Azure SQL deployment

`main.bicep` creates a SQL logical server, a small serverless database and a firewall rule for Azure services. Azure plan and SKU availability depend on the subscription and region, so review the selected SKU in the portal before deployment.

```powershell
az group create --name rg-seasonality --location westeurope
az deployment group create --resource-group rg-seasonality --template-file .\main.bicep --parameters sqlServerName=<globally-unique-name> administratorPassword=<strong-password>
```

Provisioning requires an Azure subscription and credentials. Store the resulting connection string as `ConnectionStrings__DefaultConnection`; do not commit it.
