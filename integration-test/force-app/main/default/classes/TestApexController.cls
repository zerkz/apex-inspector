public with sharing class TestApexController {
    
    class TestApexResponse {
        @AuraEnabled
        public String testString { get; set; }
        
        @AuraEnabled
        public Integer testInteger { get; set; }
        
        @AuraEnabled
        public Boolean testBoolean { get; set; }

        @AuraEnabled
        public Map <String, String> testMap { get; set; }

        @AuraEnabled
        public List<String> testList { get; set; }
    }


    @AuraEnabled
    public static List<String> testSimpleParameters(String testString, Integer testInteger, Boolean testBoolean) {
        List<String> resultList = new List<String>();
        resultList.add('testString: ' + testString);
        resultList.add('testInteger: ' + testInteger);
        resultList.add('testBoolean: ' + testBoolean);
        return resultList;
    }

    @AuraEnabled
    public static TestApexResponse testComplexParameters(String testString, Integer testInteger, Boolean testBoolean, Map<String, String> testMap, List<String> testList) {
        TestApexResponse response = new TestApexResponse();
        response.testString = testString;
        response.testInteger = testInteger;
        response.testBoolean = testBoolean;
        response.testMap = testMap;
        response.testList = testList;
        return response;    
    }

    @AuraEnabled
    public static void testThrowsException() {
        throw new AuraHandledException('This is a simulated Apex error!');
    }

    @AuraEnabled
    public static void testLimitException() {
        // Intentionally exceed SOQL query governor limit
        for (Integer i = 0; i < 101; i++) {
            User u = [SELECT Id FROM User LIMIT 1];
        }
    }

    // Visualforce Remote Action methods
    @RemoteAction
    public static String simpleRemoteMethod(String inputString) {
        return 'Remote response: ' + inputString;
    }

    @RemoteAction
    public static List<String> complexRemoteMethod(String name, Integer count, Boolean flag) {
        List<String> results = new List<String>();
        for (Integer i = 0; i < count; i++) {
            results.add(name + ' - Item ' + i + ' (flag: ' + flag + ')');
        }
        return results;
    }

    @RemoteAction
    public static Map<String, Object> remoteMethodWithError(Boolean shouldThrowError) {
        if (shouldThrowError) {
            throw new System.CalloutException('This is a remote action error!');
        }
        
        Map<String, Object> result = new Map<String, Object>();
        result.put('success', true);
        result.put('message', 'Remote method executed successfully');
        result.put('timestamp', System.now());
        return result;
    }

    @RemoteAction
    public static List<Account> getAccountsRemote(Integer limitCount) {
        return [SELECT Id, Name, Type, Industry FROM Account LIMIT :limitCount];
    }

    // Method to get Organization ID for UI API testing
    @AuraEnabled(cacheable=true)
    public static String getOrganizationId() {
        return [SELECT Id FROM Organization LIMIT 1].Id;
    }

    @AuraEnabled(cacheable=true)
    public static Organization getOrganizationInfo() {
        return [SELECT Id, Name, InstanceName FROM Organization LIMIT 1];
    }
}