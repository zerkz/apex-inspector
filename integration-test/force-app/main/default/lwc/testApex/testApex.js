import { LightningElement, track, wire } from 'lwc';
import { gql, graphql } from 'lightning/uiGraphQLApi';
import { getRecord } from 'lightning/uiRecordApi';
import getFirstAccount from '@salesforce/apex/TestApexController.getFirstAccount';
import testSimpleParameters from '@salesforce/apex/TestApexController.testSimpleParameters';
import testComplexParameters from '@salesforce/apex/TestApexController.testComplexParameters';
import testThrowsException from '@salesforce/apex/TestApexController.testThrowsException';
import testLimitException from '@salesforce/apex/TestApexController.testLimitException';

export default class TestApex extends LightningElement {
    @track simpleResult;
    @track complexResult;
    @track error;
    @track complexResultMapEntries;
    @track boxcarResults;
    @track boxcarResultsWithKeys;
    @track boxcarResultsTypes;
    @track boxcarSimpleResults;
    @track boxcarComplexResults;
    @track boxcarCallCount = 30;
    @track organizationData;
    @track graphqlError;
    @track userData;
    @track userRecordError;
    @track firstAccountId;

    // GraphQL query to get Organization InstanceName
    @wire(graphql, {
        query: gql`
            query GetOrganizationInstanceName {
                uiapi {
                    query {
                        Organization {
                            edges {
                                node {
                                    InstanceName {
                                        value
                                    }
                                    Id
                                    Name {
                                        value
                                    }
                                }
                            }
                        }
                    }
                }
            }
        `
    })
    graphqlQueryResult({ data, errors }) {
        if (data) {
            this.organizationData = data.uiapi.query.Organization.edges[0]?.node;
            this.graphqlError = undefined;
        } else if (errors) {
            console.error(errors);
            let error = errors.length > 0  ? errors[0]: '';
            this.graphqlError = error.message;
            this.organizationData = undefined;
        }
    }

    // Get first account ID
    @wire(getFirstAccount)
    firstAccountResult({ data, error }) {
        if (data) {
            this.firstAccountId = data;
            this.userRecordError = undefined;
        } else if (error) {
            console.error('First account error:', error);
            this.userRecordError = error.body ? error.body.message : error.message;
            this.firstAccountId = undefined;
        }
    }

    // uiRecordApi wire to get first account record (ID only)
    @wire(getRecord, { 
        recordId: '$firstAccountId', 
        fields: ['Account.Id'] 
    })
    userRecordResult({ data, error }) {
        console.log('userRecordResult called with data ' + data);
        if (data) {
            this.userData = data;
            this.userRecordError = undefined;
        } else if (error) {
            console.error('Account record error:', error);
            this.userRecordError = error.body ? error.body.message : error.message;
            this.userData = undefined;
        }
    }

    // This component is used to test Apex methods and their responses.
    // It can be extended with methods to call Apex and handle responses.

    handleSimpleCall() {
        testSimpleParameters({
            testString: 'Hello',
            testInteger: 42,
            testBoolean: true
        })
        .then(result => {
            this.simpleResult = result;
            this.error = undefined;
        })
        .catch(error => {
            this.error = error.body ? error.body.message : error.message;
            this.simpleResult = undefined;
        });
    }

    handleComplexCall() {
        testComplexParameters({
            testString: 'World',
            testInteger: 99,
            testBoolean: false,
            testMap: { key1: 'value1', key2: 'value2' },
            testList: ['a', 'b', 'c']
        })
        .then(result => {
            this.complexResult = result;
            this.error = undefined;
            // Convert testMap to array of {key, value} for template iteration
            this.complexResultMapEntries = result.testMap ? Object.entries(result.testMap).map(([key, value]) => ({ key, value })) : [];
        })
        .catch(error => {
            this.error = error.body ? error.body.message : error.message;
            this.complexResult = undefined;
            this.complexResultMapEntries = undefined;
        });
    }

    handleBoxcarCallCountChange(event) {
        const value = parseInt(event.target.value, 10);
        this.boxcarCallCount = isNaN(value) ? 10 : value;
    }

    handleBoxcarCalls() {
        // Fire N Apex calls in parallel, N controlled by boxcarCallCount
        const count = this.boxcarCallCount || 10;
        const promises = [];
        for (let i = 0; i < count; i++) {
            if (i % 2 === 0) {
                promises.push(testSimpleParameters({ testString: String.fromCharCode(65 + (i % 26)), testInteger: i + 1, testBoolean: i % 2 === 0 }));
            } else {
                promises.push(testComplexParameters({
                    testString: String.fromCharCode(65 + (i % 26)),
                    testInteger: i + 1,
                    testBoolean: i % 2 === 0,
                    testMap: { ['key' + i]: 'value' + i },
                    testList: [String.fromCharCode(65 + (i % 26))]
                }));
            }
        }
        Promise.all(promises)
            .then(results => {
                this.boxcarResults = results;
                this.boxcarSimpleResults = [];
                this.boxcarComplexResults = [];
                results.forEach((result, idx) => {
                    if (Array.isArray(result)) {
                        this.boxcarSimpleResults.push({ key: result[0] + idx, result, resultString: result.join(', ') });
                    } else {
                        let testMapEntries = result.testMap ? Object.entries(result.testMap).map(([key, value]) => ({ key, value })) : [];
                        this.boxcarComplexResults.push({ key: result.testString || idx, result, testMapEntries });
                    }
                });
                this.error = undefined;
            })
            .catch(error => {
                this.error = error.body ? error.body.message : error.message;
                this.boxcarResults = undefined;
                this.boxcarSimpleResults = undefined;
                this.boxcarComplexResults = undefined;
            });
    }

    handleExceptionCall() {
        testThrowsException()
            .then(() => {
                this.error = undefined;
                // Optionally set a success message or clear previous results
            })
            .catch(error => {
                this.error = error.body ? error.body.message : error.message;
            });
    }

    handleLimitExceptionCall() {
        testLimitException()
            .then(() => {
                this.error = undefined;
            })
            .catch(error => {
                this.error = error.body ? error.body.message : error.message;
            });
    }

    handleGraphQLCall() {
        // The GraphQL query is automatically executed via @wire, but we can add manual handling here
        // This method can be used to manually refresh or handle the GraphQL data
        if (this.organizationData) {
            console.log('Organization Instance Name:', this.organizationData.InstanceName?.value);
        }
    }
}