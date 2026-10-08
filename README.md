# FINWARE – Financial Analytics & Risk Management System

## 📌 Project Overview

**FINWARE** is a web-based financial analytics system designed to analyze customer transaction data and provide meaningful insights into spending behaviour, financial risk, and unusual transaction patterns.

The system combines **Data Warehousing, Data Mining, Machine Learning, and Data Visualization** to transform raw financial transactions into actionable insights.

---

## 🎯 Objectives

- Analyze customer transaction behaviour.
- Classify customers based on their spending behaviour.
- Identify customers with different levels of financial risk.
- Detect unusual or potentially anomalous transactions.
- Provide analytical dashboards and visualizations.
- Support data-driven financial decision-making.

---

## 🏗️ System Architecture

```text
Raw Transaction Data
        ↓
Data Preprocessing
        ↓
Data Warehouse
        ↓
Feature Engineering
        ↓
Machine Learning Models
        ↓
┌───────────────────────────────┐
│ Spending Behaviour            │
│ Financial Risk Classification │
│ Anomaly Detection             │
└───────────────────────────────┘
        ↓
Analytics Dashboard
        ↓
Insights & Recommendations
```

---

# 🤖 Machine Learning Algorithms

## 1. Random Forest Classifier

**Random Forest Classifier** is used for:

- Customer Spending Behaviour Classification
- Financial Risk Classification

The customers are classified into:

- 🟢 **Low**
- 🟡 **Medium**
- 🔴 **High**

### Why Random Forest?

Random Forest is suitable because financial behaviour depends on multiple interacting factors. It can capture nonlinear relationships and generally performs well for multiclass classification.

### Features Used

The model can use features such as:

- Total Spending
- Average Transaction Amount
- Transaction Frequency
- Category Diversity
- Debit/Credit Ratio
- Spending Trend

### Model Parameters

| Parameter | Value |
|---|---:|
| Number of Trees (`n_estimators`) | 200 |
| Maximum Depth (`max_depth`) | 8 |
| Minimum Samples Split | 5 |
| Minimum Samples Leaf | 2 |
| Class Weight | Balanced |
| Random State | 42 |

### Illustrative Evaluation

| Metric | Score |
|---|---:|
| Accuracy | 91.8% |
| Precision | 91.7% |
| Recall | 91.5% |
| F1-Score | 91.6% |
| ROC-AUC | 0.94 |
| Cross-Validation Accuracy | 90.9% |

> **Note:** The above evaluation values are illustrative/synthetic values used for project demonstration and should be replaced with actual test results when the final trained dataset is available.

### Why R² is not used?

R² (R-Squared) is primarily an evaluation metric for **regression problems**. Since spending behaviour and risk are classification problems, metrics such as **Accuracy, Precision, Recall, F1-Score and ROC-AUC** are more appropriate.

---

# 🚨 2. Isolation Forest

**Isolation Forest** is used for **anomaly detection**.

It identifies unusual transaction patterns that differ significantly from normal customer behaviour.

### Example Anomalies

- Unusually large transactions
- Sudden increase in spending
- Abnormal transaction frequency
- Unusual debit/credit patterns

### Parameters

| Parameter | Value |
|---|---:|
| Number of Trees | 200 |
| Contamination | 5% |
| Max Samples | Auto |
| Random State | 42 |

### Illustrative Evaluation

| Metric | Score |
|---|---:|
| Precision | 89.0% |
| Recall | 86.0% |
| F1-Score | 87.5% |
| ROC-AUC | 0.92 |

> **Note:** These values are illustrative/synthetic project metrics and should not be interpreted as results from a verified production model.

---

# 🔄 Machine Learning Workflow

```text
Transaction Data
       ↓
Data Cleaning
       ↓
Feature Engineering
       ↓
Feature Selection
       ↓
Random Forest
       ↓
┌──────────────────────────┐
│ Spending Behaviour       │
│ Financial Risk Level     │
└──────────────────────────┘

Transaction Data
       ↓
Feature Engineering
       ↓
Isolation Forest
       ↓
Anomaly Detection
```

---

# 📊 Main Features

### 👤 Customer Analytics
- Customer transaction analysis
- Spending pattern analysis
- Financial behaviour classification

### 💰 Spending Behaviour
Customers are categorized into:

**Low → Medium → High**

based on their transaction-related financial features.

### ⚠️ Financial Risk Indicator

The system provides a risk indicator based on customer financial behaviour:

- 🟢 Low Risk
- 🟡 Medium Risk
- 🔴 High Risk

### 🚨 Anomaly Detection

Isolation Forest identifies transactions or behaviour patterns that significantly differ from normal patterns.

### 📈 Dashboard

The dashboard provides:

- Transaction summaries
- Spending analysis
- Risk indicators
- Anomaly alerts
- Charts and visualizations
- Analytical insights
- Recommendations

---

# 🗄️ Data Warehouse

FINWARE follows a data warehouse approach for organizing financial transaction data.

The project uses dimensional modelling concepts including:

- Fact Tables
- Dimension Tables
- Star Schema
- Snowflake Schema
- Galaxy Schema

This allows efficient analytical queries and reporting.

---

# 🛠️ Technology Stack

### Frontend
- HTML
- CSS
- JavaScript
- Charts/Visualizations

### Backend
- Node.js
- Express.js

### Database / Data Warehouse
- SQL
- Relational Database

### Machine Learning
- Python
- Scikit-learn
- Pandas
- NumPy

### Development Tools
- Visual Studio Code
- Git
- GitHub

---

# 📂 Project Structure

```text
finware/
│
├── finware_project/
│   ├── public/
│   │   ├── css/
│   │   │   └── styles.css
│   │   ├── js/
│   │   │   └── app.js
│   │   └── index.html
│   │
│   ├── server.js
│   ├── package.json
│   └── package-lock.json
│
└── README.md
```

---

# 🚀 Installation & Setup

### 1. Clone the repository

```bash
git clone https://github.com/imrannnn-s/finware.git
```

### 2. Navigate to the project

```bash
cd finware/finware_project
```

### 3. Install dependencies

```bash
npm install
```

### 4. Start the server

```bash
npm start
```

For development:

```bash
npm run dev
```

The application can then be accessed through the local server URL shown by the application.

---

# 📌 Future Enhancements

- Real-time financial risk prediction
- Integration with live banking transaction APIs
- Improved anomaly detection
- Deep Learning-based financial prediction
- Personalized investment recommendations
- Automated financial reports
- Advanced customer segmentation
- Real-time dashboard updates

---

# 👨‍💻 Project Team

| Member | Contribution |
|---|---|
| **Amol** | Data Warehouse & Backend Integration |
| **Imran** | Data Mining & Analytics |
| **Yash** | Frontend & Visualization |

---

# 📜 Disclaimer

FINWARE is an academic/project demonstration system. The financial risk classifications, recommendations, and machine learning evaluation values are intended for educational purposes and should not be considered professional financial advice.
